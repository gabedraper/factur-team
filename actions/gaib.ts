"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import { myPermissions } from "@/lib/org";
import { NUDGE_OPENERS } from "@/lib/gaib/prompt";
import { dispatchAgent } from "@/lib/gaib/dispatch";
import { logEvent } from "@/lib/gaib/tickets";
import { postToSpace, spaceFor, canPost } from "@/lib/gaib/chat-post";
import { phrase, type Notice } from "@/lib/gaib/notices";
import { embedded } from "@/lib/gaib/embedded";

/*
 * How often Gaib is allowed to start a conversation.
 *
 * Four days. Frequent enough that a small irritation is still fresh when it
 * gets asked about, which is the whole point -- people do not remember on
 * Friday what annoyed them on Monday, and the annoyances they forget are
 * exactly the ones that never get fixed.
 *
 * The cost of asking this often is that the badge becomes wallpaper. Two things
 * hold that off: the count below, which stops asking anyone who keeps ignoring
 * it, and the fact that a nudge is a soft dot on a sidebar button rather than
 * anything that interrupts. If people start reporting that Gaib is pestering
 * them -- and Gaib will hear about it first -- this is the number to raise.
 */
const NUDGE_GAP_DAYS = 4;
/**
 * After this many unanswered openings, stop asking that person.
 *
 * Higher than it was, because at four days apart a few unanswered nudges only
 * means somebody had a busy fortnight, not that they want to be left alone.
 */
const GIVE_UP_AFTER = 5;

export type NudgeState = { ask: boolean; opener: string | null };

export async function nudgeState(): Promise<NudgeState> {
  const user = await getAuthedUser();
  if (!user) return { ask: false, opener: null };

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_nudges")
    .select("last_nudged_at,last_answered_at,nudge_count,answered_count,muted")
    .eq("user_id", user.id)
    .maybeSingle();

  const row = data as {
    last_nudged_at: string | null; last_answered_at: string | null;
    nudge_count: number; answered_count: number; muted: boolean;
  } | null;

  if (row?.muted) return { ask: false, opener: null };

  const unanswered = (row?.nudge_count ?? 0) - (row?.answered_count ?? 0);
  if (unanswered >= GIVE_UP_AFTER) return { ask: false, opener: null };

  if (row?.last_nudged_at) {
    const days = (Date.now() - Date.parse(row.last_nudged_at)) / 86400000;
    if (days < NUDGE_GAP_DAYS) return { ask: false, opener: null };
  }

  /*
   * Which opener, chosen from the count rather than at random.
   *
   * Random would sometimes hand somebody the same line twice running, and the
   * second time it reads as a script -- which is exactly the impression the
   * whole feature depends on not making.
   */
  const opener = NUDGE_OPENERS[(row?.nudge_count ?? 0) % NUDGE_OPENERS.length];
  return { ask: true, opener };
}

/** Called when someone opens Gaib from the badge, so it stops asking. */
export async function recordNudge() {
  const user = await getAuthedUser();
  if (!user) return;
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_nudges").select("nudge_count").eq("user_id", user.id).maybeSingle();
  const count = (data as { nudge_count: number } | null)?.nudge_count ?? 0;
  await db.from("gaib_nudges").upsert({
    user_id: user.id,
    last_nudged_at: new Date().toISOString(),
    nudge_count: count + 1,
  });
}

/** Called when they actually said something back. */
export async function recordAnswered() {
  const user = await getAuthedUser();
  if (!user) return;
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_nudges").select("answered_count").eq("user_id", user.id).maybeSingle();
  const count = (data as { answered_count: number } | null)?.answered_count ?? 0;
  await db.from("gaib_nudges").upsert({
    user_id: user.id,
    last_answered_at: new Date().toISOString(),
    answered_count: count + 1,
  });
}

// ---------------------------------------------------------------------------
// Picking a conversation back up
// ---------------------------------------------------------------------------

/*
 * A conversation outlives the tab it was had in.
 *
 * Every message was already being written to gaib_messages; nothing was ever
 * lost. What was missing is that the widget held the session id in React state
 * and started from nothing on a reload, so somebody who described a bug, hit
 * refresh, and came back found an empty panel and reasonably concluded the app
 * had eaten it.
 *
 * The database is the record, so resuming is a read rather than anything
 * clever: no local storage, nothing to fall out of step, and the conversation
 * follows the person to another machine because it was never tied to this one.
 */

export type ReplayLine =
  | { kind: "said"; who: "you" | "gaib"; text: string; fromChat?: boolean }
  | { kind: "ticket"; ref: number; title: string; lane: string };

export type ResumedSession = {
  id: string;
  title: string | null;
  lines: ReplayLine[];
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  blocks: unknown;
  channel: string | null;
  created_at: string;
};

/** Turn stored messages back into the lines the panel draws. */
async function replay(sessionId: string): Promise<ReplayLine[]> {
  const db = createServiceClient();

  const [{ data: messages }, { data: tickets }] = await Promise.all([
    db.from("gaib_messages")
      .select("role,content,blocks,channel,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    db.from("gaib_tickets")
      .select("ref,title,lane")
      .eq("session_id", sessionId),
  ]);

  // Tickets are matched back to the tool call that raised them by title, which
  // is what the call carried. Raising two tickets with identical titles in one
  // conversation would collapse them into one card -- possible, and a good deal
  // less confusing than dropping the card entirely.
  const byTitle = new Map(
    ((tickets ?? []) as { ref: number; title: string; lane: string }[])
      .map((t) => [t.title, t])
  );

  const lines: ReplayLine[] = [];

  for (const m of (messages ?? []) as StoredMessage[]) {
    if (m.content.trim()) {
      lines.push({
        kind: "said",
        who: m.role === "user" ? "you" : "gaib",
        text: m.content,
        // Marked so a conversation that moved between the phone and the desk
        // reads as one thing that happened in two places, rather than as a gap.
        ...(m.channel === "google_chat" ? { fromChat: true } : {}),
      });
    }

    // The card for a raised ticket lives in the tool call rather than in any
    // text, so it has to be read back out of the blocks or it disappears on
    // reload while the words around it survive.
    const blocks = m.blocks as { type?: string; name?: string; input?: Record<string, unknown> }[] | null;
    for (const b of blocks ?? []) {
      if (b?.type !== "tool_use" || b.name !== "raise_ticket") continue;
      const title = String(b.input?.title ?? "");
      const hit = byTitle.get(title);
      if (hit) lines.push({ kind: "ticket", ref: hit.ref, title: hit.title, lane: hit.lane });
    }
  }

  return lines;
}

/**
 * Everything the panel needs on open, in one round trip.
 *
 * Combined with the nudge because they are asked at the same moment and both
 * are one indexed lookup -- two server actions firing on every page load, for
 * every person, to draw one button is a cost nobody would choose deliberately.
 */
/**
 * Updates this person is owed, phrased and marked as told.
 *
 * Marked delivered at the moment they are handed over rather than when anybody
 * confirms reading them. The alternative is a queue that never empties for
 * somebody who opens the panel and closes it again, and being told the same
 * news on every visit is its own kind of not being told.
 */
async function collectUpdates(userId: string): Promise<string[]> {
  const db = createServiceClient();

  const { data } = await db
    .from("gaib_ticket_notices")
    .select("id,to_status,note,gaib_tickets(ref,title,kind)")
    .eq("user_id", userId)
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(5);

  type Ticket = { ref: number; title: string; kind: "bug" | "idea" };
  type Row = {
    id: string; to_status: string; note: string | null;
    gaib_tickets: Ticket | Ticket[] | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return [];

  const lines: string[] = [];
  for (const r of rows) {
    const ticket = embedded(r.gaib_tickets);
    if (!ticket) continue;
    const notice: Notice = {
      id: r.id,
      ref: ticket.ref,
      title: ticket.title,
      kind: ticket.kind,
      toStatus: r.to_status,
      note: r.note,
    };
    lines.push(phrase(notice));
  }

  await db
    .from("gaib_ticket_notices")
    .update({ delivered_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));

  return lines;
}

/** Whether there is anything waiting, for the dot on the button. */
export async function hasUpdates(): Promise<boolean> {
  const user = await getAuthedUser();
  if (!user) return false;
  const db = createServiceClient();
  const { count } = await db
    .from("gaib_ticket_notices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("delivered_at", null);
  return (count ?? 0) > 0;
}

export async function openingState(): Promise<{
  nudge: NudgeState;
  session: ResumedSession | null;
  updates: string[];
}> {
  const user = await getAuthedUser();
  if (!user) return { nudge: { ask: false, opener: null }, session: null, updates: [] };

  /*
   * News first, and it outranks everything.
   *
   * Somebody who is owed an answer about a thing they reported should get it
   * before they are asked how their week is going. Being asked for more
   * feedback while still waiting on the last lot is the fastest way to teach
   * people that reporting things is a one-way street.
   */
  const updates = await collectUpdates(user.id);

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_sessions")
    .select("id,title")
    .eq("user_id", user.id)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { id: string; title: string | null } | null;
  // No point asking for feedback in the same breath as delivering some.
  const nudge = updates.length ? { ask: false, opener: null } : await nudgeState();
  if (!row) return { nudge, session: null, updates };

  const lines = await replay(row.id);
  // A session with nothing in it is one somebody opened and closed. Resuming it
  // shows an empty panel that claims to be a conversation.
  if (!lines.length) return { nudge, session: null, updates };

  /*
   * Never both. Somebody returning to a conversation they were in the middle of
   * should not also be greeted with "what's annoying you today?" -- they were
   * already telling us.
   */
  return {
    nudge: { ask: false, opener: null },
    session: { id: row.id, title: row.title, lines },
    updates,
  };
}

/** Recent conversations, for the list behind the header. */
export async function recentSessions(): Promise<
  { id: string; title: string | null; at: string }[]
> {
  const user = await getAuthedUser();
  if (!user) return [];

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_sessions")
    .select("id,title,last_message_at")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })
    .limit(15);

  return ((data ?? []) as { id: string; title: string | null; last_message_at: string }[])
    .map((s) => ({ id: s.id, title: s.title, at: s.last_message_at }));
}

/** One conversation, by id, for when somebody picks an older one out of the list. */
export async function openSession(sessionId: string): Promise<ResumedSession | null> {
  const user = await getAuthedUser();
  if (!user) return null;

  // Ownership checked here rather than trusted from the client: the id comes
  // back through the browser, and a guessed one would otherwise read somebody
  // else's conversation.
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_sessions")
    .select("id,title")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  const row = data as { id: string; title: string | null } | null;
  if (!row) return null;

  /*
   * Picking an old conversation out of the list makes it the current one again.
   *
   * Without this, adding to a conversation that had been put away would leave
   * it closed, and the next reload would resume some older still-open thread
   * instead -- the panel would silently jump to a different conversation than
   * the one that was just being typed into.
   */
  await db.from("gaib_sessions").update({ status: "open" }).eq("id", row.id);

  return { id: row.id, title: row.title, lines: await replay(row.id) };
}

/**
 * Close the current conversation so the next message starts a new one.
 *
 * Closed rather than deleted. What somebody said about the app is the record
 * this whole feature exists to keep, and "start a new chat" is a statement
 * about what happens next rather than a request to forget what happened.
 */
export async function closeSession(sessionId: string): Promise<void> {
  const user = await getAuthedUser();
  if (!user) return;
  const db = createServiceClient();
  await db
    .from("gaib_sessions")
    .update({ status: "closed" })
    .eq("id", sessionId)
    .eq("user_id", user.id);
}

export async function muteNudges(muted: boolean) {
  const user = await getAuthedUser();
  if (!user) return;
  const db = createServiceClient();
  await db.from("gaib_nudges").upsert({ user_id: user.id, muted });
}

// ---------------------------------------------------------------------------
// Deciding on a ticket
// ---------------------------------------------------------------------------

async function mayDecide() {
  const perms = await myPermissions();
  return perms.has("org.manage");
}

/**
 * Approve a scoped idea, or a fix that was held back for review.
 *
 * For a scoping ticket this is the moment the work is actually authorised: the
 * agent has already read the code and written down what it would take, and the
 * ticket goes back to it in the approval lane to be built into a pull request.
 * It never goes to auto, however small the brief turned out to be -- something
 * a person deliberately decided to build is worth a person deliberately
 * deciding to merge.
 */
export async function approveTicket(ticketId: string) {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_tickets").select("id,lane,status").eq("id", ticketId).maybeSingle();
  const ticket = data as { id: string; lane: string; status: string } | null;
  if (!ticket) return { ok: false, error: "No such ticket" };

  await db.from("gaib_tickets")
    .update({ lane: "approval", status: "queued", guard_tripped: null, decision_note: null })
    .eq("id", ticketId);
  await logEvent(ticketId, "person", "approved", "sent to the agent to build");

  const sent = await dispatchAgent(ticketId, "approval");
  if (!sent.dispatched) {
    await db.from("gaib_tickets").update({ status: "failed" }).eq("id", ticketId);
    await logEvent(ticketId, "system", "not dispatched", sent.reason);
    revalidatePath("/gaib");
    return { ok: false, error: sent.reason };
  }

  revalidatePath("/gaib");
  return { ok: true };
}

/*
 * Closing a ticket, and saying why to the person who raised it.
 *
 * The reason goes onto the ticket rather than only into the event log. The
 * notice trigger reads the ticket, so this is the difference between the
 * reporter hearing your reasoning and hearing the coding agent's technical
 * notes with your name on them -- which is what happened until now.
 */
export async function rejectTicket(ticketId: string, why: string) {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };
  const db = createServiceClient();
  await db
    .from("gaib_tickets")
    .update({ status: "rejected", decision_note: why.trim() || null })
    .eq("id", ticketId);
  await logEvent(ticketId, "person", "rejected", why || undefined);
  revalidatePath("/gaib");
  return { ok: true };
}

/** Mark a ticket done by hand, for work that happened outside the agent. */
export async function closeTicket(
  ticketId: string,
  status: "shipped" | "duplicate",
  why = ""
) {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };
  const db = createServiceClient();
  await db
    .from("gaib_tickets")
    .update({ status, decision_note: why.trim() || null })
    .eq("id", ticketId);
  await logEvent(ticketId, "person", status, why || undefined);
  revalidatePath("/gaib");
  return { ok: true };
}

/** Send a ticket back to the agent after a failure, or after editing it. */
export async function retryTicket(ticketId: string) {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_tickets").select("lane").eq("id", ticketId).maybeSingle();
  const lane = (data as { lane: "auto" | "approval" | "scoping" } | null)?.lane;
  if (!lane) return { ok: false, error: "No such ticket" };

  const sent = await dispatchAgent(ticketId, lane);
  if (!sent.dispatched) return { ok: false, error: sent.reason };
  await db.from("gaib_tickets").update({ status: "queued", decision_note: null }).eq("id", ticketId);
  await logEvent(ticketId, "person", "retried");
  revalidatePath("/gaib");
  return { ok: true };
}

/**
 * Put a question to whoever raised a ticket, through their own Gaib.
 *
 * Not an email and not a separate thread. It waits in their conversation and
 * gets asked at a natural moment, because the question is nearly always "what
 * were you actually trying to do" -- and that gets a better answer in a chat
 * than in a form somebody has to go and find.
 */
export async function askAboutTicket(ticketId: string, question: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };

  const text = question.trim();
  if (!text) return { ok: false, error: "Type the question first" };

  const me = await getAuthedUser();
  if (!me) return { ok: false, error: "Not allowed" };

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_tickets").select("id,ref,title,raised_by").eq("id", ticketId).maybeSingle();
  const t = data as { id: string; ref: number; title: string; raised_by: string | null } | null;

  if (!t?.raised_by) return { ok: false, error: "Nobody is recorded as having raised this one" };

  const { error } = await db.from("gaib_ticket_questions").insert({
    ticket_id: t.id, asked_by: me.id, asked_of: t.raised_by, question: text,
  });
  if (error) return { ok: false, error: error.message };

  await logEvent(t.id, "person", "asked the reporter", text.slice(0, 200));

  /*
   * Nudged in Chat if they are reachable there, so the question does not wait
   * until they happen to open the app. Best effort: it is already saved, and
   * will be asked the moment they next talk to Gaib either way.
   */
  if (canPost()) {
    const space = await spaceFor(t.raised_by);
    if (space) {
      await postToSpace(space, `Quick one about "${t.title}" — ask me and I will explain.`);
    }
  }

  revalidatePath("/gaib");
  return { ok: true };
}

/** The questions and answers on a ticket, for the card. */
export async function ticketConversation(ticketId: string) {
  if (!(await mayDecide())) return [];
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_ticket_questions")
    .select("id,question,answer,asked_at,answered_at,closed_at")
    .eq("ticket_id", ticketId)
    .order("asked_at");
  return (data ?? []) as {
    id: string; question: string; answer: string | null;
    asked_at: string; answered_at: string | null; closed_at: string | null;
  }[];
}

/*
 * What is still open, for the panel.
 *
 * Two different questions wearing one shape. Whoever decides on tickets wants
 * the ones waiting on them; everybody else wants the ones they reported and has
 * not heard back about. Both are "what is outstanding for me", and neither is
 * worth a trip to another screen to find out.
 */
export type OpenTicket = {
  id: string;
  ref: number;
  title: string;
  status: string;
  sessionId: string | null;
  waitingOnYou: boolean;
  /*
   * Whether this is their own. Decides where a click goes: your own
   * conversation reopens in the panel, somebody else's ticket goes to the queue
   * screen -- and only whoever runs the queue can open that, so a person's own
   * ticket must never send them there.
   */
  mine: boolean;
};

export async function myOpenTickets(): Promise<OpenTicket[]> {
  const user = await getAuthedUser();
  if (!user) return [];

  const db = createServiceClient();
  const decides = (await myPermissions()).has("org.manage");

  const live = ["new", "queued", "running", "awaiting_review", "failed"];

  const query = db
    .from("gaib_tickets")
    .select("id,ref,title,status,session_id,raised_by")
    .in("status", live)
    .order("created_at", { ascending: false })
    .limit(12);

  // Whoever decides sees everything outstanding; everybody else sees their own.
  const { data } = decides ? await query : await query.eq("raised_by", user.id);

  return ((data ?? []) as {
    id: string; ref: number; title: string; status: string;
    session_id: string | null; raised_by: string | null;
  }[]).map((t) => ({
    id: t.id,
    ref: t.ref,
    title: t.title,
    status: t.status,
    sessionId: t.session_id,
    // The distinction that decides whether this is a nag or an update.
    waitingOnYou: decides && (t.status === "awaiting_review" || t.status === "failed"),
    mine: t.raised_by === user.id,
  }));
}

/**
 * Merge the pull request a ticket is waiting on, and let it ship.
 *
 * Approve used to send every ticket back to the agent, including ones that
 * already had a finished pull request sitting there -- so the button that looked
 * like "yes, do it" quietly meant "throw that away and do it again". Work that
 * was already reviewed, rebuilt from scratch, for nothing.
 *
 * Where there is a pull request, approving means merging it. The ticket is
 * marked shipped by the workflow that watches for merges, so the status still
 * comes from what actually happened rather than from what was clicked.
 */
export async function mergeTicket(ticketId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_tickets").select("id,ref,pr_url").eq("id", ticketId).maybeSingle();
  const ticket = data as { id: string; ref: number; pr_url: string | null } | null;

  if (!ticket?.pr_url) {
    return { ok: false, error: "There is no pull request on this one to merge" };
  }

  const token = process.env.GAIB_GITHUB_TOKEN;
  if (!token) return { ok: false, error: "No GitHub token is configured" };

  // .../owner/repo/pull/123
  let parts = ticket.pr_url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);

  /*
   * A compare link instead of a pull request.
   *
   * The agent falls back to one when it cannot open a pull request, and for a
   * while the commonest reason was that the pull request already existed --
   * so a ticket that went round twice ended up pointing at a page that cannot
   * be merged, having overwritten the address of the one that can. The
   * workflow no longer does that, but tickets from before it are still sitting
   * in the queue, and the branch name in the link is enough to find the real
   * one.
   */
  if (!parts) {
    const compare = ticket.pr_url.match(
      /github\.com\/([^/]+)\/([^/]+)\/compare\/[^.]+\.\.\.(.+)$/
    );
    if (compare) {
      const [, owner, repo, branch] = compare;
      const found = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls` +
          `?state=open&head=${owner}:${decodeURIComponent(branch)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      ).then((r) => (r.ok ? r.json() : null)).catch(() => null);

      const open = (found as { html_url?: string }[] | null)?.[0]?.html_url;
      if (open) {
        // Put the real one back, so this is looked up once rather than on
        // every press.
        await db.from("gaib_tickets").update({ pr_url: open }).eq("id", ticket.id);
        parts = open.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      }
    }
  }

  if (!parts) return { ok: false, error: `Could not read the pull request address: ${ticket.pr_url}` };
  const [, owner, repo, number] = parts;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merge_method: "squash",
          commit_title: `[Ticket ${ticket.ref}] approved and merged`,
        }),
      }
    );

    if (!res.ok) {
      const why = (await res.text()).slice(0, 200);
      /*
       * A merge can be refused for perfectly ordinary reasons -- a conflict, a
       * check still running, the branch behind. Passed through as-is, because
       * "could not merge" without the reason sends somebody to GitHub to find
       * out what this already knows.
       */
      await logEvent(ticket.id, "person", "merge refused", why);
      return { ok: false, error: `GitHub would not merge it: ${why}` };
    }

    await logEvent(ticket.id, "person", "merged", `pull request ${number}`);
    /*
     * The status is deliberately not set here. The workflow that watches for a
     * merge sets it, so shipped means the code is on main rather than that a
     * button was pressed -- and the two are not always the same thing.
     */
    revalidatePath("/gaib");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not reach GitHub" };
  }
}

/**
 * The conversation a ticket came out of.
 *
 * Behind the same permission as the transcripts page rather than the one that
 * runs the queue. Deciding on a ticket and reading what somebody said in a
 * private conversation are different rights, and putting the second on a card
 * that several people can open would have quietly undone the narrowing that was
 * done deliberately.
 */
export async function ticketChat(ticketId: string): Promise<ReplayLine[] | null> {
  if (!(await myPermissions()).has("gaib.transcripts")) return null;

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_tickets").select("session_id").eq("id", ticketId).maybeSingle();
  const sessionId = (data as { session_id: string | null } | null)?.session_id;
  if (!sessionId) return [];

  return replay(sessionId);
}
