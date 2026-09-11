import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { actAs, findMemberByEmail } from "./act-as";
import { defaultAgent, myRoleIds, mayUse } from "./agents";
import { runTurn, type TurnImage } from "./chat";
import {
  listRoomMessages, postToSpace, postGifToSpace, downloadAttachment, threadContext,
  type RoomMessage, type ThreadContext,
} from "./chat-post";
import { lookUpPeople } from "@/lib/google/people";

/*
 * Gaib listening to a whole room.
 *
 * Google only hands an app the messages that mention it, so in the testing
 * room Matt reported a bug twice and heard nothing: the first time he edited
 * @gaib into the message (edits are not delivered), the second he did not
 * mention it at all. With an admin's approval an app may list every message,
 * and this does -- then decides, message by message, whether Gaib has anything
 * to add.
 *
 * Deciding is most of it. A room is people talking to each other, and an
 * assistant that answers everything turns it into a room where one voice
 * drowns the rest. So a small, cheap model looks at each message first and
 * only a genuine report, question, reply to today's test or big moment goes
 * to Gaib proper. When unsure, it stays quiet.
 */

const GATE_MODEL = "claude-haiku-4-5";

/** A burst of messages is a queue, not a reason to post ten replies. */
const MAX_REPLIES_PER_RUN = 3;

const Gate = z.object({
  respond: z.boolean(),
  reason: z.string().describe("A few words on why, for the log."),
});

async function shouldRespond(
  text: string,
  todaysTest: string | null,
  hasImage: boolean,
  thread: ThreadContext | null
): Promise<z.infer<typeof Gate>> {
  const client = new Anthropic();
  try {
    const res = await client.messages.parse({
      model: GATE_MODEL,
      max_tokens: 200,
      output_config: { format: zodOutputFormat(Gate) },
      system:
        "You decide whether Gaib, the assistant in a team's testing chat for their internal web app, " +
        "should reply to a message it was NOT directly asked about. Reply yes only if the message:\n" +
        "1. reports something broken, confusing, slow or missing in the app;\n" +
        "2. asks a question about the app or how to do something at work that an assistant could answer;\n" +
        "3. is someone reporting back on today's test;\n" +
        "4. is a genuinely big win or an absurd failure worth a one-line reaction;\n" +
        "5. answers, pushes back on, or follows up something Gaib said or asked earlier in the thread.\n" +
        "Say no to people talking to each other, logistics, greetings, thanks, jokes between colleagues, " +
        "and anything addressed to a specific person other than Gaib. When unsure, say no -- a quiet " +
        "assistant is fine, a noisy one gets muted.",
      messages: [{
        role: "user",
        content:
          (todaysTest ? `Today's test in this room: ${todaysTest}\n\n` : "") +
          (thread ? `Earlier in this thread (lines from Gaib are the assistant):\n${thread.text}\n\n` : "") +
          `Message${hasImage ? " (with a screenshot)" : ""}: ${text || "(no text)"}`,
      }],
    });
    return res.parsed_output ?? { respond: false, reason: "gate returned nothing" };
  } catch {
    // A gate that fails stays shut. Missing one message is recoverable;
    // answering every message because the gate broke is not.
    return { respond: false, reason: "gate failed" };
  }
}

/** Who sent it, as an email, so Gaib can act as them. */
async function emailFor(senderUser: string, lookupAs: string): Promise<string | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_chat_people").select("email").eq("chat_user", senderUser).maybeSingle();
  const known = (data as { email: string } | null)?.email;
  if (known) return known;

  // Chat gives an app the sender's id and never their address. The id is the
  // same as their Google account id, which the directory can resolve.
  const id = senderUser.replace(/^users\//, "");
  const { people } = await lookUpPeople([id], lookupAs);
  const email = people[0]?.email ?? null;
  if (email) {
    await db.from("gaib_chat_people").upsert({
      email: email.toLowerCase(), chat_user: senderUser, display_name: people[0]?.name ?? null,
    });
  }
  return email;
}

async function todaysTest(space: string): Promise<string | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_room_tests").select("subject")
    .eq("space_name", space).eq("for_date", new Date().toISOString().slice(0, 10)).maybeSingle();
  return (data as { subject: string } | null)?.subject ?? null;
}

/** The room's own conversation for this person, never their private one. */
async function roomSession(userId: string, agentId: string, space: string): Promise<string> {
  const db = createServiceClient();
  const ref = `room:${space}`;
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data: existing } = await db
    .from("gaib_sessions").select("id")
    .eq("user_id", userId).eq("status", "open").eq("channel_ref", ref)
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data, error } = await db
    .from("gaib_sessions")
    .insert({ user_id: userId, agent_id: agentId, opened_by: "user", channel: "google_chat", channel_ref: ref })
    .select("id").single();
  if (error || !data) throw new Error(`could not start a room conversation: ${error?.message}`);
  return (data as { id: string }).id;
}

/** Answer one message in the room, as the person who sent it. */
async function answer(
  space: string,
  m: RoomMessage,
  email: string,
  thread: ThreadContext | null
): Promise<boolean> {
  const person = await findMemberByEmail(email);
  if (!person) return false;
  const agent = await defaultAgent();
  if (!agent || !mayUse(agent, await myRoleIds(person.userId))) return false;

  const acting = await actAs(email);
  if (!acting.ok) return false;

  try {
    const images: TurnImage[] = [];
    for (const a of m.attachments.slice(0, 4)) {
      const got = await downloadAttachment(a.resourceName);
      const type = a.contentType.toLowerCase().replace("image/jpg", "image/jpeg");
      if (got.ok && (type === "image/png" || type === "image/jpeg" || type === "image/gif" || type === "image/webp")) {
        images.push({ mediaType: type, data: got.data });
      }
    }

    const said: string[] = [];
    const gifs: string[] = [];
    for await (const e of runTurn({
      agent,
      sessionId: await roomSession(person.userId, agent.id, space),
      userId: person.userId,
      email: acting.session.email,
      db: acting.session.db,
      message: m.text || "(sent a screenshot without saying anything)",
      channel: "google_chat",
      pageUrl: null,
      person: { name: person.fullName ?? email, role: null },
      room: { name: space, thread: thread?.text ?? null },
      images,
    })) {
      if (e.type === "text") said.push(e.text);
      if (e.type === "gif") gifs.push(e.url);
    }

    const text = said.join("").trim();
    if (!text) return false;
    await postToSpace(space, text, m.threadName);
    for (const url of gifs) await postGifToSpace(space, url, m.threadName).catch(() => {});
    return true;
  } finally {
    await acting.session.release();
  }
}

export type ReadResult = {
  space: string;
  status: string;
  read: number;
  answered: number;
};

/** Read what is new in one room and answer what deserves answering. */
export async function readRoom(space: string, lookupAs: string): Promise<ReadResult> {
  const db = createServiceClient();
  const { data: room } = await db
    .from("gaib_rooms").select("last_read_at").eq("space_name", space).maybeSingle();

  // First run starts from now, not from the beginning of the room -- nobody
  // wants Gaib replying to last month.
  const since = (room as { last_read_at: string | null } | null)?.last_read_at
    ?? new Date(Date.now() - 60_000).toISOString();

  const listed = await listRoomMessages(space, since);
  if (!listed.ok) {
    const status = listed.status === 403
      ? "waiting for admin approval of chat.app.messages.readonly"
      : listed.reason;
    await db.from("gaib_rooms").update({ read_status: status }).eq("space_name", space);
    return { space, status, read: 0, answered: 0 };
  }

  const test = await todaysTest(space);
  let answered = 0;
  let newest = since;

  for (const m of listed.messages) {
    if (m.createTime > newest) newest = m.createTime;

    // Claimed first, so an overlapping run cannot answer it too.
    const { error: claimed } = await db
      .from("gaib_room_seen").insert({ message_name: m.name, space_name: space });
    if (claimed) continue;

    // Gaib's own messages, and anything that mentioned it -- which the webhook
    // has already answered -- are never picked up here.
    if (m.senderType === "BOT" || m.mentionsApp) {
      await db.from("gaib_room_seen").update({ decided: "skipped: bot or mention" }).eq("message_name", m.name);
      continue;
    }
    if (!m.text && m.attachments.length === 0) continue;
    if (answered >= MAX_REPLIES_PER_RUN) {
      await db.from("gaib_room_seen").update({ decided: "skipped: reply limit this run" }).eq("message_name", m.name);
      continue;
    }

    const thread = m.threadName ? await threadContext(space, m.threadName, m.name) : null;
    const gate = await shouldRespond(m.text, test, m.attachments.length > 0, thread);
    await db.from("gaib_room_seen")
      .update({ decided: `${gate.respond ? "respond" : "quiet"}: ${gate.reason}` })
      .eq("message_name", m.name);
    if (!gate.respond || !m.senderUser) continue;

    const email = await emailFor(m.senderUser, lookupAs);
    if (!email) continue;

    if (await answer(space, m, email, thread)) answered++;
  }

  await db.from("gaib_rooms")
    .update({ last_read_at: newest, read_status: "reading" })
    .eq("space_name", space);

  return { space, status: "reading", read: listed.messages.length, answered };
}
