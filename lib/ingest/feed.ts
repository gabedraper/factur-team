import { createServiceClient } from "@/lib/supabase/server";

/*
 * What the activity feed page reads: the events as they landed, with what the
 * resolver made of each, and the names behind the ids it chose.
 */

export const STATUSES = ["pending", "waiting", "resolved", "needs_review", "skipped", "failed"] as const;
export const SOURCES = ["dialpad", "orum", "mixmax", "gmail"] as const;

export type FeedStatus = (typeof STATUSES)[number];

export type Facts = {
  kind?: string;
  direction?: string;
  occurred_at?: string;
  user_email?: string;
  other_phone_raw?: string;
  other_email?: string;
  contact_name?: string;
  subject?: string;
  outcome?: string;
  duration_secs?: number;
  list_name?: string;
  sequence_name?: string;
};

export type FeedRow = {
  id: string;
  source: string;
  external_id: string;
  event_type: string | null;
  received_at: string;
  status: FeedStatus;
  attempts: number;
  member_id: string | null;
  opp_activity_id: string | null;
  resolution: {
    reason?: string;
    row?: string;
    rules?: Record<string, string>;
    facts?: Facts;
    member_id?: string;
    opportunity_id?: string;
    client_id?: string;
    candidates?: string[];
    error?: string;
  };
  payload?: unknown;
};

export type FeedNames = {
  members: Map<string, string>;
  opportunities: Map<string, { name: string | null; client: string | null }>;
};

export async function loadFeed(opts: { status?: string; source?: string; limit?: number }) {
  const db = createServiceClient();
  let q = db
    .from("activity_events")
    .select("id, source, external_id, event_type, received_at, status, attempts, member_id, opp_activity_id, resolution")
    .order("received_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status && (STATUSES as readonly string[]).includes(opts.status)) q = q.eq("status", opts.status);
  if (opts.source && (SOURCES as readonly string[]).includes(opts.source)) q = q.eq("source", opts.source);

  const [{ data, error }, { data: counts }] = await Promise.all([q, db.rpc("activity_feed_counts")]);
  if (error) throw new Error(`activity_events: ${error.message}`);
  const rows = (data ?? []) as FeedRow[];

  return {
    rows,
    names: await namesFor(rows),
    counts: (counts ?? {}) as Record<string, number>,
  };
}

export async function loadEvent(id: string): Promise<{ row: FeedRow; names: FeedNames } | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("activity_events")
    .select("id, source, external_id, event_type, received_at, status, attempts, member_id, opp_activity_id, resolution, payload")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as FeedRow;
  return { row, names: await namesFor([row]) };
}

/** The people and pursuits behind the ids the resolver wrote down. */
async function namesFor(rows: FeedRow[]): Promise<FeedNames> {
  const db = createServiceClient();
  const memberIds = new Set<string>();
  const oppIds = new Set<string>();
  for (const r of rows) {
    if (r.member_id) memberIds.add(r.member_id);
    if (r.resolution?.member_id) memberIds.add(r.resolution.member_id);
    if (r.resolution?.opportunity_id) oppIds.add(r.resolution.opportunity_id);
  }

  const members = new Map<string, string>();
  const opportunities = new Map<string, { name: string | null; client: string | null }>();

  if (memberIds.size) {
    const { data } = await db.from("org_members").select("id, full_name, email").in("id", [...memberIds]);
    for (const m of (data ?? []) as { id: string; full_name: string | null; email: string }[]) {
      members.set(m.id, m.full_name ?? m.email);
    }
  }
  if (oppIds.size) {
    const { data } = await db.from("opportunities").select("id, name, client_id").in("id", [...oppIds]);
    const opps = (data ?? []) as { id: string; name: string | null; client_id: string | null }[];
    const clientIds = [...new Set(opps.map((o) => o.client_id).filter((c): c is string => !!c))];
    const clients = new Map<string, string>();
    if (clientIds.length) {
      const { data: cs } = await db.from("org_clients").select("id, name").in("id", clientIds);
      for (const c of (cs ?? []) as { id: string; name: string }[]) clients.set(c.id, c.name);
    }
    for (const o of opps) {
      opportunities.set(o.id, { name: o.name, client: o.client_id ? clients.get(o.client_id) ?? null : null });
    }
  }
  return { members, opportunities };
}

/** One line saying what the event was, for the list. */
export function describe(r: FeedRow): string {
  const f = r.resolution?.facts;
  if (f?.subject) return f.subject;
  if (r.event_type) return r.event_type;
  return r.external_id;
}

/** The other party, as the vendor named them. */
export function counterparty(r: FeedRow): string {
  const f = r.resolution?.facts;
  if (!f) return "";
  return [f.contact_name, f.other_email ?? f.other_phone_raw].filter(Boolean).join(" · ");
}

/** What happened to it, in a few words. */
export function outcome(r: FeedRow, names: FeedNames): string {
  const res = r.resolution ?? {};
  switch (r.status) {
    case "resolved": {
      const opp = res.opportunity_id ? names.opportunities.get(res.opportunity_id) : null;
      const where = opp ? [opp.client, opp.name].filter(Boolean).join(" · ") : "an opportunity";
      const how = res.row === "new" ? "New row on" : res.row === "external_key" ? "Same as Salesforce's row on" : "Matched Salesforce's row on";
      return `${how} ${where}`;
    }
    case "needs_review": return res.reason ?? "Could not decide";
    case "skipped": return res.reason ?? "Not an activity";
    case "failed": return res.error ?? "Failed";
    case "waiting": return "Call still under way";
    default: return "Waiting for the resolver";
  }
}
