import { createClient } from "@/lib/supabase/server";
import { visibleOwnerIds } from "@/lib/org";
import { assembleLeads, contactName, type Lead, type LeadRow, type TaskRow } from "./assemble";

export type { Lead, TimelineEvent, StageSpan } from "./assemble";
export { contactName };

export type LeadFilters = {
  rep?: string; client?: string; outcome?: string; search?: string;
  arrivedDays?: number; limit?: number;
};

export async function getLeads(filters: LeadFilters = {}) {
  const supabase = createClient();
  const limit = Math.min(filters.limit ?? 150, 500);

  // Reps see their own leads, managers their team's, admins everything.
  const owners = await visibleOwnerIds();
  if (owners !== null && owners.length === 0) {
    return assembleLeads([], []);
  }

  let query = supabase
    .from("sf_opp_leads_raw")
    .select(
      "id,name,stagename,createddate,ownerid,owner_name,accountid,account_name," +
        "account_contact_name__c,contact_title__c,client__r_name,lead_source__c," +
        "cadence__c,sequence_name__c,lost_reason__c,referred_by_name__c"
    )
    .order("createddate", { ascending: false });

  if (owners !== null) query = query.in("ownerid", owners);
  if (filters.rep) query = query.eq("owner_name", filters.rep);
  if (filters.client) query = query.eq("client__r_name", filters.client);
  if (filters.arrivedDays) {
    const since = new Date(Date.now() - filters.arrivedDays * 86400000);
    query = query.gte("createddate", since.toISOString());
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(`name.ilike.${term},account_name.ilike.${term}`);
  }

  const { data: leadRows, error } = await query.limit(limit);
  if (error) throw new Error(`leads query failed: ${error.message}`);
  const rows = (leadRows ?? []) as unknown as LeadRow[];
  if (!rows.length) return assembleLeads([], []);

  // Only the visible leads' activity is fetched. Supabase caps a response at
  // 1000 rows, so both the id filter and the result set are walked in chunks.
  const ids = rows.map((r) => r.id);
  const tasks: TaskRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error: taskErr } = await supabase
        .from("sf_opp_tasks_raw")
        .select("id,whatid,subject,tasksubtype,calltype,createddate,owner_name")
        .in("whatid", slice)
        .order("createddate", { ascending: true })
        .range(from, from + 999);
      if (taskErr) throw new Error(`activity query failed: ${taskErr.message}`);
      const page = (data ?? []) as unknown as TaskRow[];
      tasks.push(...page);
      if (page.length < 1000) break;
    }
  }


  return assembleLeads(rows, tasks);
}

/** Distinct values for the filter dropdowns, cheap enough to run every load. */
export async function getFilterOptions() {
  const supabase = createClient();
  const { data } = await supabase
    .from("sf_opp_leads_raw")
    .select("owner_name,client__r_name")
    .limit(6000);
  const reps = new Set<string>();
  const clients = new Set<string>();
  for (const r of (data ?? []) as { owner_name: string | null; client__r_name: string | null }[]) {
    if (r.owner_name) reps.add(r.owner_name);
    if (r.client__r_name) clients.add(r.client__r_name);
  }
  // localeCompare so accented names sort where a reader expects, not by byte.
  return {
    reps: [...reps].sort((a, b) => a.localeCompare(b)),
    clients: [...clients].sort((a, b) => a.localeCompare(b)),
  };
}
