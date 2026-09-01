import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyAndParse, reply, type ChatEvent } from "@/lib/gaib/google-chat";
import { readKey } from "@/lib/gaib/service-key";
import { actAs, findMemberByEmail } from "@/lib/gaib/act-as";
import { runTurn } from "@/lib/gaib/chat";
import { defaultAgent, myRoleIds, mayUse } from "@/lib/gaib/agents";

/*
 * Gaib, reachable from Google Chat.
 *
 * The same agent, the same tools and the same permissions as the panel in the
 * app -- the only thing that differs is how the message arrives and how the
 * answer goes back. Anything that decides what somebody may see is shared with
 * the in-app route rather than reimplemented here, because two copies of a
 * permission rule is one copy that will eventually be wrong.
 *
 * Chat waits about thirty seconds for a reply and then gives up. An agent that
 * looks two things up can take longer than that, so the work is given a budget
 * and a slow answer is turned into an honest sentence rather than a timeout
 * that leaves somebody staring at nothing.
 */

export const maxDuration = 60;

/** Google's patience, minus enough to get an answer back through the wire. */
const BUDGET_MS = 25_000;

/*
 * Is this thing switched on?
 *
 * Google reports every refusal as "Gaib not responding", which covers a missing
 * setting and a forged request equally and tells you nothing about which. The
 * refusal has to stay silent -- an error that explains itself helps somebody
 * work out what to forge next -- so the setup check lives here instead.
 *
 * Says whether the project number is set and never what it is. Knowing that a
 * setting exists helps nobody sign anything.
 */
/*
 * Note that something arrived, and what it looked like.
 *
 * "Gaib not responding" covers a request that was refused, one that errored,
 * and one that never arrived, and those have completely different fixes. This
 * makes the three distinguishable: nothing here at all means Google is not
 * reaching the address; rows saying refused mean it is, and the signature check
 * is the problem.
 *
 * The audience is read out of the token WITHOUT verifying it, and used for
 * nothing but this note. That is safe because it decides nothing -- but it is
 * exactly the sort of thing that stops being safe the moment somebody reaches
 * for it later, so: never trust anything this function reads.
 */
async function noteArrival(
  authorization: string | null,
  verified: boolean,
  eventType: string | null,
  // Names only, never values. The shape of the payload is what is needed to
  // work out why a field came back empty; what is in it is none of this
  // function's business.
  bodyKeys: string | null
) {
  let audience: string | null = null;
  let issuer: string | null = null;

  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : null;

  if (token) {
    try {
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")
      ) as { aud?: unknown; iss?: unknown };
      audience = claims.aud == null ? null : String(claims.aud);
      issuer = claims.iss == null ? null : String(claims.iss);
    } catch {
      audience = "(unreadable)";
    }
  }

  try {
    await createServiceClient().from("gaib_chat_probe").insert({
      had_auth_header: Boolean(authorization),
      verified,
      claimed_audience: audience,
      claimed_issuer: issuer,
      event_type: eventType,
      body_keys: bodyKeys,
    });
  } catch {
    // Diagnostics must never be the reason a reply fails.
  }
}

/** What became of the last arrival, appended to its row. */
async function noteOutcome(outcome: string) {
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("gaib_chat_probe").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
    const row = data as { id: number } | null;
    if (row) await db.from("gaib_chat_probe").update({ outcome }).eq("id", row.id);
  } catch {
    /* diagnostics must never break a reply */
  }
}

export async function GET() {
  const configured = Boolean(process.env.GOOGLE_CHAT_PROJECT_NUMBER);
  const agent = await defaultAgent().catch(() => null);

  const { data: arrivals } = await createServiceClient()
    .from("gaib_chat_probe")
    .select("at,verified,claimed_issuer,event_type,body_keys,outcome")
    .order("at", { ascending: false })
    .limit(5);

  const seen = (arrivals ?? []) as Record<string, unknown>[];

  /*
   * Which project the posting key belongs to, read from the key itself.
   *
   * Reported rather than judged, because the two things worth comparing are not
   * comparable from here. A key carries the project *id* -- a word, like
   * scoreboard-505215 -- and the Chat configuration shows the project *number*.
   * They are two names for the same project, and code that treats a mismatch
   * between them as an error will confidently flag a correct setup as broken.
   * That very nearly happened, and cost a detour.
   *
   * So: say what the key is, and let it be checked against the one place both
   * names appear together, which is the Cloud console home page.
   */
  const key = readKey();
  const postingKey = key.ok
    ? {
        project: key.project_id,
        account: key.client_email,
        check: "This must be the project the Chat app is configured in. " +
               "The console home page shows a project's id and number together.",
      }
    : { problem: key.problem, detail: key.detail };

  return NextResponse.json({
    ready: configured && Boolean(agent),
    projectNumberSet: configured,
    expectedAudience: process.env.GOOGLE_CHAT_PROJECT_NUMBER ?? null,
    agent: agent ? agent.name : null,
    postingKey,
    messagesSeen: seen.length,
    lastArrivals: seen,
    ...(configured ? {} : { fix: "Set GOOGLE_CHAT_PROJECT_NUMBER in Vercel, then redeploy." }),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const authorization = request.headers.get("authorization");
  const event = await verifyAndParse(authorization, body);

  await noteArrival(
    authorization,
    Boolean(event),
    (body as { type?: string } | null)?.type ?? null,
    body && typeof body === "object" ? Object.keys(body).join(",") : null
  );

  if (!event) {
    // Silent to the caller, loud in the logs -- the person setting this up needs
    // to know which of the two it was, and the caller must not.
    console.warn(
      process.env.GOOGLE_CHAT_PROJECT_NUMBER
        ? "google-chat: a request failed verification"
        : "google-chat: GOOGLE_CHAT_PROJECT_NUMBER is not set, so nothing can verify"
    );
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (event.kind === "REMOVED_FROM_SPACE") return NextResponse.json({});

  if (event.kind === "ADDED_TO_SPACE") {
    return NextResponse.json(
      reply(
        "Hello. Ask me about the app, your clients, or anything you can see in it — " +
          "and tell me when something is broken and I will get it fixed.",
        event
      )
    );
  }

  if (event.kind !== "MESSAGE" || !event.text) {
    await noteOutcome(`ignored: kind=${event.kind} textLength=${event.text.length}`);
    return NextResponse.json({});
  }

  try {
    const body = await answer(event);
    await noteOutcome(`replied ${JSON.stringify(body).length} bytes`);
    return NextResponse.json(body);
  } catch (e) {
    console.error("google-chat", e);
    await noteOutcome(`threw: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
    return NextResponse.json(
      reply("Something went wrong at my end. Try again in a moment.", event)
    );
  }
}

async function answer(event: ChatEvent) {
  const person = await findMemberByEmail(event.senderEmail);
  if (!person) {
    return reply(
      "I do not recognise that account. Sign in to team.facturmfg.com once and I will know who you are.",
      event
    );
  }

  const agent = await defaultAgent();
  if (!agent) return reply("No assistant is set up yet.", event);

  if (!mayUse(agent, await myRoleIds(person.userId))) {
    return reply("That assistant is not available to you.", event);
  }

  /*
   * A session belonging to the sender, so every tool runs under their own
   * permissions exactly as it would in the app. Released whatever happens --
   * a live session left lying about is the one thing here worth being fussy
   * over.
   */
  const acting = await actAs(event.senderEmail);
  if (!acting.ok) {
    return reply(
      acting.reason === "no-such-account"
        ? "Sign in to team.facturmfg.com once and I will know who you are."
        : "I could not check who you are just now. Try again shortly.",
      event
    );
  }

  try {
    const sessionId = await conversationFor(person.userId, agent.id, event.spaceName);

    const turn = runTurn({
      agent,
      sessionId,
      userId: person.userId,
      email: acting.session.email,
      db: acting.session.db,
      message: event.text,
      channel: "google_chat",
      pageUrl: null,
      person: { name: person.fullName ?? acting.session.email, role: null },
    });

    /*
     * Collected rather than streamed: Chat shows a message when it is finished,
     * so there is nothing to stream to. The pieces are joined because a turn
     * that used a tool produces text on both sides of it.
     */
    const said: string[] = [];
    const deadline = Date.now() + BUDGET_MS;
    let ranOut = false;

    for await (const e of turn) {
      if (e.type === "text") said.push(e.text);
      if (e.type === "error") said.push(`Something went wrong: ${e.message}`);
      if (Date.now() > deadline) {
        ranOut = true;
        break;
      }
    }

    const text = said.join("").trim();

    if (!text && ranOut) {
      /*
       * Breaking out abandons the reply but not the work -- the loop writes
       * each step to the database as it goes, so the answer finishes and is
       * waiting in the panel. Saying so is better than a silence that looks
       * like it was never asked.
       */
      return reply(
        "That is taking me longer than Chat will wait. I have kept working on it — " +
          "open Gaib in the app in a minute and the answer will be there.",
        event
      );
    }

    return reply(text || "I do not have an answer for that.", event);
  } finally {
    await acting.session.release();
  }
}

/*
 * One conversation, wherever it is being had.
 *
 * Deliberately not keyed on the space. Somebody who asks Gaib something on
 * their phone on the way in and then opens the app at their desk is having one
 * conversation, and making them repeat themselves because they changed window
 * is the sort of thing that makes an assistant feel like two assistants.
 *
 * Bounded by time rather than by place: recent enough that following on makes
 * sense, old enough to start fresh. Picking up a fortnight-old thread because
 * it happens to be the last one is worse than not picking up anything.
 */
const RESUME_WITHIN_HOURS = 12;

async function conversationFor(
  userId: string,
  agentId: string,
  spaceName: string | null
): Promise<string> {
  const db = createServiceClient();

  // Remembered so Gaib can speak first later. A direct message space does not
  // exist until somebody opens one, so this is the only moment it can be known.
  if (spaceName) {
    await db.from("gaib_chat_spaces").upsert({
      user_id: userId,
      space_name: spaceName,
      last_seen: new Date().toISOString(),
    });
  }

  const since = new Date(Date.now() - RESUME_WITHIN_HOURS * 3600_000).toISOString();

  const { data: existing } = await db
    .from("gaib_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "open")
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const found = existing as { id: string } | null;
  if (found) return found.id;

  const { data, error } = await db
    .from("gaib_sessions")
    .insert({
      user_id: userId,
      agent_id: agentId,
      opened_by: "user",
      channel: "google_chat",
      channel_ref: spaceName ?? "chat",
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`could not start a conversation: ${error?.message}`);
  return (data as { id: string }).id;
}
