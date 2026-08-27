import { createServiceClient } from "@/lib/supabase/server";
import { dispatchAgent } from "./dispatch";

export type Lane = "auto" | "approval" | "scoping";
export type TicketKind = "bug" | "idea";
export type Severity = "blocking" | "painful" | "annoying" | "cosmetic";

export type TicketStatus =
  | "new" | "queued" | "running" | "awaiting_review"
  | "shipped" | "rejected" | "failed" | "duplicate";

export type Ticket = {
  id: string;
  ref: number;
  kind: TicketKind;
  title: string;
  body: string;
  page_url: string | null;
  severity: Severity;
  lane: Lane;
  lane_reason: string | null;
  status: TicketStatus;
  brief: string | null;
  pr_url: string | null;
  commit_sha: string | null;
  run_url: string | null;
  guard_tripped: string | null;
  raised_by: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

/** Statuses that mean the ticket is still live, for duplicate checking. */
const LIVE: TicketStatus[] = ["new", "queued", "running", "awaiting_review", "failed"];

export async function logEvent(
  ticketId: string,
  actor: "gaib" | "agent" | "person" | "system",
  event: string,
  detail?: string
) {
  const db = createServiceClient();
  await db.from("gaib_ticket_events").insert({
    ticket_id: ticketId, actor, event, detail: detail ?? null,
  });
}

/**
 * Tickets that look like they are about the same thing.
 *
 * Deliberately loose. This exists to stop Gaib raising the same bug from four
 * different people in one afternoon, and for that job a few extra near-matches
 * shown to the model are harmless -- it reads them and decides. A precise
 * search that missed the duplicate would be worse.
 */
export async function searchTickets(query: string): Promise<
  Pick<Ticket, "ref" | "title" | "kind" | "status" | "created_at">[]
> {
  const db = createServiceClient();
  const words = query.split(/\s+/).map((w) => w.replace(/[%,()]/g, "")).filter((w) => w.length > 3);
  if (!words.length) return [];

  // PostgREST `or` takes a comma-separated filter list; each word is tried
  // against both columns.
  const clause = words
    .flatMap((w) => [`title.ilike.%${w}%`, `body.ilike.%${w}%`])
    .join(",");

  const { data } = await db
    .from("gaib_tickets")
    .select("ref,title,kind,status,created_at")
    .in("status", LIVE)
    .or(clause)
    .order("created_at", { ascending: false })
    .limit(6);

  return (data ?? []) as Pick<Ticket, "ref" | "title" | "kind" | "status" | "created_at">[];
}

export type NewTicket = {
  sessionId: string | null;
  raisedBy: string;
  kind: TicketKind;
  title: string;
  body: string;
  severity: Severity;
  lane: Lane;
  laneReason: string;
  pageUrl: string | null;
};

/**
 * Write the ticket down, then set the agent going.
 *
 * A scoping ticket goes to the agent too. That surprises people, so: it is sent
 * to *scope*, not to build. It reads the codebase, works out what the idea
 * would actually touch and what it would cost, writes that up, and stops. The
 * point is that by the time Gabe reads the idea it already comes with an
 * answer to "what would this take", which is the question that otherwise turns
 * every idea into a research task before it can even be judged.
 */
export async function createTicket(input: NewTicket): Promise<Ticket> {
  const db = createServiceClient();

  const { data, error } = await db
    .from("gaib_tickets")
    .insert({
      session_id: input.sessionId,
      raised_by: input.raisedBy,
      kind: input.kind,
      title: input.title,
      body: input.body,
      severity: input.severity,
      lane: input.lane,
      lane_reason: input.laneReason,
      page_url: input.pageUrl,
      status: "new",
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(`could not raise ticket: ${error?.message}`);
  const ticket = data as Ticket;

  await logEvent(ticket.id, "gaib", "raised", `${input.lane} lane -- ${input.laneReason}`);

  const sent = await dispatchAgent(ticket.id, input.lane);
  if (sent.dispatched) {
    await db.from("gaib_tickets").update({ status: "queued" }).eq("id", ticket.id);
    await logEvent(ticket.id, "system", "queued", "handed to the agent");
    ticket.status = "queued";
  } else {
    await logEvent(ticket.id, "system", "not dispatched", sent.reason);
  }

  return ticket;
}
