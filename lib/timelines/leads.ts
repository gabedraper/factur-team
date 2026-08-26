import { after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { visibleOwnerIds, prospectingOwnerIds } from "@/lib/org";
import {
  assembleLeads, contactName, summariseByOwner, ALL_REPS,
  DISPLAY_DAYS, METRICS_DAYS, type Lead, type LeadRow, type TaskRow, type RepSummary,
} from "./assemble";
import { parseUtc } from "./business-day";
import { readSummaries, refreshSummariesIfStale } from "./summaries";

export type { Lead, TimelineEvent, StageSpan, Pipeline, RepSummary } from "./assemble";
export { ALL_REPS, DISPLAY_DAYS, METRICS_DAYS };
export { contactName };

// A rep is identified by their Salesforce user id, never by their name --
// see getFilterOptions below.
export type RepOption = { id: string; name: string };

export type LeadFilters = {
  rep?: string; client?: string; outcome?: string; search?: string;
};

export async function getLeads(filters: LeadFilters = {}) {
  const supabase = await createClient();

  // Reps see their own leads, managers their team's, admins everything.
  const [owners, prospectors] = await Promise.all([visibleOwnerIds(), prospectingOwnerIds()]);

  // A lead belongs to the prospecting pipeline when its owner's role in the app
  // says so, rather than anything read off the Salesforce record.
  const pipelineFor = (row: LeadRow) =>
    row.ownerid && prospectors.has(row.ownerid) ? ("prospecting" as const) : ("client" as const);
  if (owners !== null && owners.length === 0) {
    // No Salesforce account, so nothing here is theirs. Distinct from "no rows
    // matched": the page needs to say which, or an unlinked person sees a blank
    // table and reasonably concludes it is broken.
    return {
      ...assembleLeads([], []),
      summaries: {} as Record<string, RepSummary>,
      held: 0,
      scope: "unlinked" as const,
    };
  }

  // More than the week on show, because the headline tiles are meant to be the
  // rep's record rather than a description of the rows below them -- but capped
  // at METRICS_DAYS rather than everything the sync holds, since this path
  // assembles every lead and its activity in memory.
  const rows: LeadRow[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase
      .from("sf_opp_leads_raw")
      .select(
        "id,name,stagename,createddate,ownerid,owner_name,accountid,account_name," +
          "account_contact_name__c,contact_title__c,client__r_name,lead_source__c," +
          "prospecting_lead_status__c,cadence__c,sequence_name__c,lost_reason__c," +
          "referred_by_name__c"
      )
      .order("createddate", { ascending: false })
      .gte("createddate", new Date(Date.now() - METRICS_DAYS * 86400000).toISOString());

    if (owners !== null) query = query.in("ownerid", owners);
    if (filters.rep) query = query.eq("ownerid", filters.rep);
    if (filters.client) query = query.eq("client__r_name", filters.client);
    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or(`name.ilike.${term},account_name.ilike.${term}`);
    }

    const { data, error } = await query.range(from, from + 999);
    if (error) throw new Error(`leads query failed: ${error.message}`);
    const page = (data ?? []) as unknown as LeadRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const emptyScope = (owners === null ? "all" : "scoped") as "all" | "scoped";
  if (!rows.length) {
    return { ...assembleLeads([], []), summaries: {} as Record<string, RepSummary>, held: 0, scope: emptyScope };
  }

  /*
   * Supabase caps a response at 1000 rows, and a URL can only carry so many ids
   * in one `in` filter, so the activity is fetched in chunks. Reading the whole
   * window instead of one page of leads turned this from two round trips into
   * around fifty, which run a few at a time rather than one after another --
   * sequentially that is seconds of dead time on every page load.
   */
  const ids = rows.map((r) => r.id);
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) slices.push(ids.slice(i, i + 100));

  async function fetchSlice(slice: string[]): Promise<TaskRow[]> {
    const out: TaskRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: taskErr } = await supabase
        .from("sf_opp_tasks_raw")
        .select("id,whatid,subject,tasksubtype,calltype,createddate,owner_name")
        .in("whatid", slice)
        .order("createddate", { ascending: true })
        .range(from, from + 999);
      if (taskErr) throw new Error(`activity query failed: ${taskErr.message}`);
      const page = (data ?? []) as unknown as TaskRow[];
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }

  // Six at a time: enough to hide the latency, not so many that a large scope
  // opens fifty connections at once.
  const tasks: TaskRow[] = [];
  for (let i = 0; i < slices.length; i += 6) {
    const batch = await Promise.all(slices.slice(i, i + 6).map(fetchSlice));
    for (const page of batch) tasks.push(...page);
  }

  const assembled = assembleLeads(rows, tasks, pipelineFor);

  // Only the recent arrivals travel to the browser, newest first -- which is
  // the order the query already returned.
  const since = Date.now() - DISPLAY_DAYS * 86400000;
  const recent = assembled.leads.filter((l) => parseUtc(l.created).getTime() >= since);

  /*
   * The tiles come from the stored rebuild, which covers the year rather than
   * the thirty days read here, and does not move when the board is filtered --
   * which is what they were always meant to do.
   *
   * Before the first rebuild there is nothing stored, so they fall back to the
   * window in hand. That is a smaller number rather than a wrong one, and it
   * beats a page of dashes on the day this ships.
   */
  const stored = await readSummaries();
  const summaries = stored.generatedAt
    ? stored.summaries
    : summariseByOwner(assembled.leads);

  // Kept fresh by whoever opens the page, after their response has gone.
  after(() => refreshSummariesIfStale());

  return {
    ...assembled,
    leads: recent,
    summaries,
    summariesFrom: stored.generatedAt,
    held: assembled.leads.length,
    scope: emptyScope,
  };
}

/**
 * Values for the filter dropdowns, scoped the same way the leads are.
 *
 * Offering a client nobody can see leads for is a dead end, and worse, it leaks
 * the client list to someone whose own leads never mention them.
 *
 * showRepFilter is false for anyone who only sees their own leads -- filtering
 * by rep when every row is yours does nothing.
 */
export async function getFilterOptions() {
  const owners = await visibleOwnerIds();

  if (owners !== null && owners.length === 0) {
    return { reps: [] as RepOption[], clients: [] as string[], showRepFilter: false };
  }

  const db = createServiceClient();

  // Reps come from the people in the app, not from whoever happens to own a
  // lead this month. That means someone with no current leads still appears --
  // filtering to them and finding nothing is a real answer -- and a name spelled
  // two ways in Salesforce cannot split one person into two entries, because
  // the match is on their Salesforce id.
  let people = db
    .from("org_members")
    .select("full_name,email,salesforce_user_id")
    .eq("active", true)
    .not("salesforce_user_id", "is", null)
    .order("full_name");
  if (owners !== null) people = people.in("salesforce_user_id", owners);

  const { data: members } = await people;
  const reps: RepOption[] = ((members ?? []) as {
    full_name: string | null; email: string; salesforce_user_id: string;
  }[]).map((m) => ({ id: m.salesforce_user_id, name: m.full_name ?? m.email }));

  // Clients still come from the leads: a client with nothing to show is not a
  // useful filter, and the list is only meaningful in terms of the visible rows.
  const supabase = await createClient();
  let leadQuery = supabase.from("sf_opp_leads_raw").select("client__r_name").limit(6000);
  if (owners !== null) leadQuery = leadQuery.in("ownerid", owners);
  const { data } = await leadQuery;

  const clients = new Set<string>();
  for (const r of (data ?? []) as { client__r_name: string | null }[]) {
    if (r.client__r_name) clients.add(r.client__r_name);
  }

  // localeCompare so accented names sort where a reader expects, not by byte.
  return {
    reps: reps.sort((a, b) => a.name.localeCompare(b.name)),
    clients: [...clients].sort((a, b) => a.localeCompare(b)),
    // More than one visible owner means a manager or wider; exactly one means
    // every row is already theirs.
    showRepFilter: owners === null || owners.length > 1,
  };
}
