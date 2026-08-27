"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import { myPermissions } from "@/lib/org";
import { NUDGE_OPENERS } from "@/lib/gaib/prompt";
import { dispatchAgent } from "@/lib/gaib/dispatch";
import { logEvent } from "@/lib/gaib/tickets";

/*
 * How often Gaib is allowed to start a conversation.
 *
 * Three weeks, and only if the last one was actually answered within a
 * reasonable stretch. The number is a judgement, not a finding: it is set at
 * the point where being asked feels like someone checking in rather than a
 * system running. Shorten it and the badge becomes something people learn to
 * click away without reading, which costs more than the extra answers gain.
 */
const NUDGE_GAP_DAYS = 21;
/** After this many unanswered openings, stop asking that person. */
const GIVE_UP_AFTER = 3;

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
