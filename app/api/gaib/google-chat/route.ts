import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyAndParse, reply, type ChatEvent } from "@/lib/gaib/google-chat";
import { readKey } from "@/lib/gaib/service-key";
import { actAs, findMemberByEmail } from "@/lib/gaib/act-as";
import { runTurn, type TurnImage } from "@/lib/gaib/chat";
import { postToSpace, downloadAttachment, postGifToSpace, threadContext } from "@/lib/gaib/chat-post";
import { defaultAgent, myRoleIds, mayUse } from "@/lib/gaib/agents";
import { gifsEnabled } from "@/lib/gaib/gif";
import { vary } from "@/lib/gaib/vary";

/*
 * Gaib, reachable from Google Chat.
 *
 * The same agent, the same tools and the same permissions as the panel in the
 * app -- the only thing that differs is how the message arrives and how the
 * answer goes back. Anything that decides what somebody may see is shared with
 * the in-app route rather than reimplemented here, because two copies of a
 * permission rule is one copy that will eventually be wrong.
 *
 * Chat waits about thirty seconds for a reply and then gives up, and puts
 * "Gaib not responding" in front of the person. Nobody should ever see that,
 * so the budget below is a race against the clock rather than a check between
 * steps -- see the note on it.
 */

export const maxDuration = 300;

/*
 * How long to wait before promising rather than answering.
 *
 * Raced against the turn, not checked between its steps. The previous version
 * looked at the clock each time the agent produced something, which cannot
 * fire while a single slow tool call is in flight -- and that is exactly when
 * it is needed. Elijah asked a question that sent Gaib to Google Chat search;
 * that one call took thirty seconds on its own, the check never got to run,
 * Chat gave up at thirty, and the reply went out at thirty-eight to nobody.
 *
 * Eight seconds because the ordinary question is answered in three or four and
 * deserves one message rather than two, while anything reaching for Gmail,
 * Chat or Drive will always be slower than Chat will wait and should say so
 * immediately.
 */
const ANSWER_OR_PROMISE_MS = 8_000;

/** The promise, said differently each time. It is the line people see most. */
const PROMISES = [
  "give me a minute on that one, gotta look a few things up. i'll send it here.",
  "on it. digging in, i'll drop the answer here in a sec.",
  "good q. let me look, back in a minute.",
  "hang on, checking a couple things. answer's coming here.",
  "one sec, looking into it. i'll post back here.",
] as const;

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
    // Whether GIPHY_API_KEY reached this deployment. A variable saved in
    // Vercel only applies to deployments made after it, so "I added the key"
    // and "GIFs work" are two different facts -- this says which.
    gifs: gifsEnabled(),
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
    /*
     * A room says hello differently, and says what it will not do here.
     *
     * People in a shared space need to know two things a direct message never
     * raises: that Gaib only hears messages that mention it, and that anything
     * private belongs in a direct message. Said once, on arrival, rather than
     * discovered when somebody asks about their inbox in front of their team.
     */
    if (!event.isDirectMessage && event.spaceName) {
      await createServiceClient()
        .from("gaib_rooms")
        .upsert({ space_name: event.spaceName, last_seen: new Date().toISOString() },
                { onConflict: "space_name" })
        .then(() => {}, () => {});

      return NextResponse.json(
        reply(
          vary("room-hello", [
            "hey yall, i'm Gaib. mention me (@Gaib) and i'll answer. if something in the app is broken or annoying, tell me here and i'll raise it and come back when it's fixed.\n\n" +
              "one thing: this is a shared space, so i won't get into clients, money, or anyone's own email or files in here. dm me for those.",
            "Team, Gaib here. tag me with @Gaib and i'm on it. broken stuff, weird stuff, questions, throw it at me and i'll come back here when it's sorted.\n\n" +
              "heads up: shared space, so no clients, money, or personal email and files in here. dm me for that.",
          ]),
          event
        )
      );
    }

    return NextResponse.json(
      reply(
        vary("dm-hello", [
          "hey! ask me about the app, your clients, or anything you can see in it. and tell me when something's broken, i'll get it fixed.",
          "hey buddy. anything about the app or your clients, just ask. if something's broken tell me and i'll sort it.",
        ]),
        event
      )
    );
  }

  /*
   * A screenshot on its own is a message.
   *
   * This used to drop anything with no text, and the first thing a tester did
   * in the room was send a screenshot of the problem -- which arrived, was
   * logged as "textLength=0", and was ignored. A picture with no words still
   * needs an answer.
   */
  if (event.kind !== "MESSAGE" || (!event.text && event.images.length === 0)) {
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

  /** Set when the turn carries on past the response and owns the session. */
  let finishing = false;

  try {
    const inRoom = !event.isDirectMessage;
    await rememberWho(event, inRoom);
    const sessionId = await conversationFor(person.userId, agent.id, event.spaceName, inRoom);
    const thread = inRoom && event.spaceName && event.threadName
      ? await threadContext(event.spaceName, event.threadName, event.messageName)
      : null;

    const turn = runTurn({
      agent,
      sessionId,
      userId: person.userId,
      email: acting.session.email,
      db: acting.session.db,
      message: event.text || "(sent a screenshot without saying anything)",
      images: await fetchImages(event),
      channel: "google_chat",
      pageUrl: null,
      person: { name: person.fullName ?? acting.session.email, role: null },
      room: inRoom ? { name: event.spaceName, thread: thread?.text ?? null } : null,
    });

    /*
     * The whole turn as one promise, so it can be raced rather than watched.
     *
     * Collected rather than streamed: Chat shows a message when it is finished,
     * so there is nothing to stream to. The pieces are joined because a turn
     * that used a tool produces text on both sides of it.
     *
     * Nothing breaks out of this loop. Breaking calls return() on the generator
     * and ends the turn mid-tool-call, which is how somebody once got told the
     * answer would be waiting in the app when the work had already stopped and
     * no answer was ever coming. It runs to the end either way; the only
     * question is whether anyone is still on the line to receive it.
     */
    const gifs: string[] = [];
    const work = (async () => {
      const said: string[] = [];
      for await (const e of turn) {
        if (e.type === "text") said.push(e.text);
        if (e.type === "error") said.push(`Something went wrong: ${e.message}`);
        if (e.type === "gif") gifs.push(e.url);
      }
      return said.join("").trim();
    })();

    /** The GIF, if Gaib chose one, posted under the reply once it has gone. */
    const sendGifs = async () => {
      if (!event.spaceName) return;
      for (const url of gifs) {
        await postGifToSpace(event.spaceName, url, event.threadName).catch(() => {});
      }
    };

    /*
     * Answer if it is quick, promise if it is not.
     *
     * A timer, not a clock check between steps: a single slow tool call --
     * Gmail, Chat search, Drive -- holds the loop for thirty seconds or more,
     * and a check that only runs between steps cannot fire while it does. That
     * is precisely when the promise is needed, so it has to come from outside.
     */
    const quick = await Promise.race([
      work.then((text) => ({ ready: true as const, text })),
      new Promise<{ ready: false }>((resolve) =>
        setTimeout(() => resolve({ ready: false }), ANSWER_OR_PROMISE_MS)
      ),
    ]);

    if (quick.ready) {
      // After the response has gone, so the words land first and the GIF
      // follows as the punchline rather than arriving ahead of the joke.
      if (gifs.length) after(sendGifs);
      return reply(quick.text || "I do not have an answer for that.", event);
    }

    /*
     * Still working. Say so now, deliver later.
     *
     * The response has to leave well inside Chat's thirty seconds or Chat
     * replaces it with "Gaib not responding" and the person is left with no
     * reason to expect anything further. The turn carries on untouched and its
     * answer is posted into the same conversation when it lands.
     */
    if (event.spaceName) {
      finishing = true;
      const space = event.spaceName;

      after(async () => {
        try {
          const text = await work;
          await postToSpace(
            space,
            text ||
              "I could not get to the bottom of that one. Ask me again and I will try a different way."
          );
          await sendGifs();
        } catch {
          // Say something rather than nothing: a promise to reply that goes
          // quiet is worse than the original timeout.
          await postToSpace(space, vary("beat-me", [
            "that one beat me, something broke on my end.",
            "ugh, that one got me. something went wrong on my side.",
            "yeah that didn't work, my fault. try me again in a bit.",
          ])).catch(() => {});
        } finally {
          await acting.session.release();
        }
      });

      return reply(vary("promise", PROMISES), event);
    }

    /*
     * No space to post into, which should not happen for a direct message.
     * The turn still finishes and is still written to the conversation, so the
     * answer is in the app even though it cannot be delivered here.
     */
    finishing = true;
    after(async () => {
      try { await work; } catch { /* recorded either way */ }
      finally { await acting.session.release(); }
    });

    return reply(
      "give me a minute on that one, i need to look a few things up. i can't post back in here though, so check Gaib in the app and it'll be there.",
      event
    );
  } finally {
    // Not when the answer is still being written: the work that carries on
    // after the response needs the session, and releases it itself.
    if (!finishing) await acting.session.release();
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

/*
 * Learn how to mention this person, and note the room if this is one.
 *
 * A message mentions somebody with their Chat id, not their email, and the
 * only place Gaib ever learns that id is a message they send. So it is kept
 * the first time it is seen, and the daily test post can ping them by name.
 */
/** Download whatever images came with the message. Failures are skipped. */
async function fetchImages(event: ChatEvent): Promise<TurnImage[]> {
  const out: TurnImage[] = [];
  for (const img of event.images.slice(0, 4)) {
    const got = await downloadAttachment(img.resourceName);
    if (!got.ok) continue;
    const type = img.contentType.toLowerCase().replace("image/jpg", "image/jpeg");
    if (type === "image/png" || type === "image/jpeg" || type === "image/gif" || type === "image/webp") {
      out.push({ mediaType: type, data: got.data });
    }
  }
  return out;
}

async function rememberWho(event: ChatEvent, inRoom: boolean) {
  try {
    const db = createServiceClient();
    if (event.senderUser && event.senderEmail) {
      await db.from("gaib_chat_people").upsert({
        email: event.senderEmail.toLowerCase(),
        chat_user: event.senderUser,
        display_name: event.senderName,
        seen_at: new Date().toISOString(),
      });
    }
    if (inRoom && event.spaceName) {
      await db.from("gaib_rooms").upsert(
        { space_name: event.spaceName, last_seen: new Date().toISOString() },
        { onConflict: "space_name", ignoreDuplicates: false }
      );
    }
  } catch {
    // Bookkeeping. Never the reason somebody does not get an answer.
  }
}

async function conversationFor(
  userId: string,
  agentId: string,
  spaceName: string | null,
  inRoom: boolean
): Promise<string> {
  const db = createServiceClient();

  // Remembered so Gaib can speak first later. A direct message space does not
  // exist until somebody opens one, so this is the only moment it can be known.
  //
  // Direct messages only. A room is not anybody's private channel: recording
  // one here meant the first time somebody spoke to Gaib in a shared space,
  // their private notices started going to everyone in it.
  //
  // The conflict target is named because the table no longer has user_id for
  // its primary key -- it is keyed on a surrogate id so that somebody without
  // an app account can still have a conversation. Left to the default, this
  // would insert a second row for the same person on every message.
  if (spaceName && !inRoom) {
    await db.from("gaib_chat_spaces").upsert(
      {
        user_id: userId,
        space_name: spaceName,
        last_seen: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  }

  const since = new Date(Date.now() - RESUME_WITHIN_HOURS * 3600_000).toISOString();

  /*
   * A room keeps its own conversation, and a private one never picks up a room.
   *
   * This resumed whatever the person had open most recently, wherever it was.
   * Somebody who had been asking Gaib privately about a client and then
   * mentioned it in a shared space would have had that private conversation
   * carried into the room -- in the history Gaib reads before answering
   * everyone.
   */
  const roomRef = spaceName ? `room:${spaceName}` : null;
  let query = db
    .from("gaib_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "open")
    .gte("last_message_at", since);

  query = inRoom && roomRef
    ? query.eq("channel_ref", roomRef)
    : query.not("channel_ref", "like", "room:%");

  const { data: existing } = await query
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
      channel_ref: inRoom && roomRef ? roomRef : (spaceName ?? "chat"),
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`could not start a conversation: ${error?.message}`);
  return (data as { id: string }).id;
}
