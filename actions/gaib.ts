"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import { myPermissions } from "@/lib/org";
import { NUDGE_OPENERS } from "@/lib/gaib/prompt";
import { dispatchAgent } from "@/lib/gaib/dispatch";
import { logEvent } from "@/lib/gaib/tickets";
import { phrase, type Notice } from "@/lib/gaib/notices";

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

  // The embedded ticket comes back as an array even on a to-one relation, which
  // is PostgREST being consistent rather than helpful.
  type Row = {
    id: string; to_status: string; note: string | null;
    gaib_tickets: { ref: number; title: string; kind: "bug" | "idea" }[] | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return [];

  const lines: string[] = [];
  for (const r of rows) {
    const ticket = r.gaib_tickets?.[0];
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
    .update({ lane: "approval", status: "queued", guard_tripped: null })
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

export async function rejectTicket(ticketId: string, why: string) {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };
  const db = createServiceClient();
  await db.from("gaib_tickets").update({ status: "rejected" }).eq("id", ticketId);
  await logEvent(ticketId, "person", "rejected", why || undefined);
  revalidatePath("/gaib");
  return { ok: true };
}

/** Mark a ticket done by hand, for work that happened outside the agent. */
export async function closeTicket(ticketId: string, status: "shipped" | "duplicate") {
  if (!(await mayDecide())) return { ok: false, error: "Not allowed" };
  const db = createServiceClient();
  await db.from("gaib_tickets").update({ status }).eq("id", ticketId);
  await logEvent(ticketId, "person", status);
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
  await db.from("gaib_tickets").update({ status: "queued" }).eq("id", ticketId);
  await logEvent(ticketId, "person", "retried");
  revalidatePath("/gaib");
  return { ok: true };
}
