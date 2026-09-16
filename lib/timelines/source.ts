import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DELIVERED_LEADS_OWNER, NURTURE_STAGE, NURTURE_STATUS, COLD_LIST_STAGES,
  type LeadRow, type TaskRow,
} from "./assemble";

/*
 * Where the timelines' rows come from: the app's own opportunities and their
 * activity -- the same tables the Opportunities list and record pages read.
 *
 * They used to come from Coupler's hourly copy of a Salesforce report, which
 * covered current clients only and held less than half the leads. Two copies
 * of Salesforce meant two answers to "what happened on this lead"; this is the
 * one that stays.
 *
 * The rest of the timeline code still speaks in the report's column names
 * (createddate, whatid, tasksubtype...). Rather than rename every field
 * through assemble and the board, the two mappers here translate once.
 */

/** Exclusions that make a "lead", in PostgREST's own filter grammar. */
export const LEAD_STAGE_EXCLUSIONS = [NURTURE_STAGE, ...COLD_LIST_STAGES];

const LEAD_SELECT =
  "id,salesforce_opportunity_id,name,stage,lead_status,salesforce_created_at,salesforce_owner_id," +
  "lead_source,cadence,sequence_name,lost_reason,referred_by," +
  "owner:org_members!opportunities_owner_member_id_fkey(full_name)," +
  "crm_accounts(salesforce_account_id,name)," +
  "crm_contacts(first_name,last_name,title)";

type OppRow = {
  id: string;
  salesforce_opportunity_id: string;
  name: string | null;
  stage: string | null;
  lead_status: string | null;
  salesforce_created_at: string | null;
  salesforce_owner_id: string | null;
  lead_source: string | null;
  cadence: string | null;
  sequence_name: string | null;
  lost_reason: string | null;
  referred_by: string | null;
  owner: { full_name: string | null } | null;
  crm_accounts: { salesforce_account_id: string | null; name: string | null } | null;
  crm_contacts: { first_name: string | null; last_name: string | null; title: string | null } | null;
  org_clients: { name: string | null } | null;
};

export function toLeadRow(r: OppRow): LeadRow {
  return {
    id: r.salesforce_opportunity_id,
    appId: r.id,
    name: r.name,
    stagename: r.stage,
    createddate: r.salesforce_created_at ?? "",
    ownerid: r.salesforce_owner_id,
    owner_name: r.owner?.full_name ?? null,
    accountid: r.crm_accounts?.salesforce_account_id ?? null,
    account_name: r.crm_accounts?.name ?? null,
    account_contact_name__c:
      [r.crm_contacts?.first_name, r.crm_contacts?.last_name].filter(Boolean).join(" ") || null,
    contact_title__c: r.crm_contacts?.title ?? null,
    client__r_name: r.org_clients?.name ?? null,
    lead_source__c: r.lead_source,
    prospecting_lead_status__c: r.lead_status,
    cadence__c: r.cadence,
    sequence_name__c: r.sequence_name,
    lost_reason__c: r.lost_reason,
    referred_by_name__c: r.referred_by,
  };
}

export type LeadQuery = {
  /** ISO timestamp; leads created at or after it. */
  since: string;
  /** Salesforce user ids the viewer may see; null means everyone. */
  owners: string[] | null;
  rep?: string;
  client?: string;
  search?: string;
};

/**
 * One page of leads. `from` is the offset; the caller pages until a short one.
 *
 * The client filter needs the client embedded inner, or PostgREST keeps the
 * row and blanks the client instead of dropping it -- so the embed is chosen
 * per query rather than fixed in the select.
 */
export function leadPage(db: SupabaseClient, q: LeadQuery, from: number, size: number, count = false) {
  const clientEmbed = q.client ? "org_clients!inner(name)" : "org_clients(name)";
  let query = db
    .from("opportunities")
    .select(`${LEAD_SELECT},${clientEmbed}`, count ? { count: "exact" } : undefined)
    .gte("salesforce_created_at", q.since)
    .neq("salesforce_owner_id", DELIVERED_LEADS_OWNER)
    .not("stage", "in", `(${LEAD_STAGE_EXCLUSIONS.map((s) => `"${s}"`).join(",")})`)
    /* Spelt as an "or" because a plain "not equal" drops nulls too, and most
       leads have no prospecting status at all. */
    .or(`lead_status.is.null,lead_status.neq.${NURTURE_STATUS}`)
    .order("salesforce_created_at", { ascending: false })
    /* Ties on the timestamp would let a row repeat or vanish between pages. */
    .order("id");

  if (q.owners !== null) query = query.in("salesforce_owner_id", q.owners);
  if (q.rep) query = query.eq("salesforce_owner_id", q.rep);
  if (q.client) query = query.eq("org_clients.name", q.client);
  /* The opportunity name is "Account - Client - Contact", so one column
     answers a search for the company or the person. */
  if (q.search) query = query.ilike("name", `%${q.search.replace(/[%,()]/g, " ").trim()}%`);

  return query.range(from, from + size - 1);
}

const TASK_SELECT =
  "id,salesforce_activity_id,opportunity_id,activity_type,subject,direction,occurred_at,metadata," +
  "org_members(full_name)";

type ActivityRow = {
  id: string;
  salesforce_activity_id: string | null;
  opportunity_id: string;
  activity_type: string;
  subject: string | null;
  direction: string | null;
  occurred_at: string;
  metadata: { created_date?: string } | null;
  org_members: { full_name: string | null } | null;
};

/* The report's TaskSubtype spellings, which classify() matches on. */
const SUBTYPE: Record<string, string> = {
  call: "Call", email: "Email", task: "Task", meeting: "Meeting", note: "Task",
};

/**
 * `sfIdOf` maps our opportunity id to its Salesforce id, because assemble()
 * groups activity by the lead's id and the lead's id is the Salesforce one --
 * it has to be, for the link into Salesforce.
 *
 * The time is Salesforce's CreatedDate where the sync kept it (all but four
 * rows), not occurred_at: that is ActivityDate first, which is a date with no
 * time and, on 2,080 rows, a year in the 2080s.
 */
export function toTaskRow(a: ActivityRow, sfIdOf: (appId: string) => string | undefined): TaskRow | null {
  const whatid = sfIdOf(a.opportunity_id);
  if (!whatid) return null;
  return {
    id: a.salesforce_activity_id ?? a.id,
    whatid,
    subject: a.subject,
    tasksubtype: SUBTYPE[a.activity_type] ?? null,
    calltype: a.direction === "inbound" ? "Inbound" : a.direction === "outbound" ? "Outbound" : null,
    createddate: a.metadata?.created_date ?? a.occurred_at,
    owner_name: a.org_members?.full_name ?? null,
  };
}

/** One page of activity for a slice of opportunity ids (ours, not Salesforce's). */
export function taskPage(db: SupabaseClient, appIds: string[], from: number, size: number) {
  return db
    .from("opp_activities")
    .select(TASK_SELECT)
    .in("opportunity_id", appIds)
    .order("occurred_at", { ascending: true })
    .order("id")
    .range(from, from + size - 1);
}

export type { OppRow, ActivityRow };
