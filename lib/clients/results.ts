import { createClient } from "@/lib/supabase/server";
import type { ClientResult, MonthRow } from "./result-metrics";

export * from "./result-metrics";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toClient(r: any): ClientResult {
  return {
    id: r.salesforce_client_id,
    name: r.name,
    website: r.website,
    status: r.status,
    services: r.services ?? [],
    primaryService: r.primary_service,
    headlineMetric: r.headline_metric ?? null,
    clientSince: r.client_since,
    clientEnd: r.client_end,
    monthsElapsed: r.months_elapsed,
    businessType: r.business_type,
    businessTypeInferred: Boolean(r.business_type_inferred),
    capabilities: r.capabilities ?? [],
    materials: r.materials ?? [],
    certifications: r.certifications ?? [],
    marketsServed: r.markets_served ?? [],
    employees: r.employees,
    sizeBand: r.size_band,
    sizeInferred: Boolean(r.size_inferred),
    industry: r.industry,
    summary: r.summary,
    monthsWithResults: r.months_with_results ?? 0,
    leads: r.leads ?? 0,
    appointments: r.appointments ?? 0,
    quotes: r.quotes ?? 0,
    pos: r.pos ?? 0,
    poAmount: Number(r.po_amount ?? 0),
    quoteAmount: Number(r.quote_amount ?? 0),
    first3: {
      leads: r.first_3_leads ?? 0,
      appointments: r.first_3_appointments ?? 0,
      quotes: r.first_3_quotes ?? 0,
      pos: r.first_3_pos ?? 0,
    },
    leadsPerMonth: r.leads_per_month === null ? null : Number(r.leads_per_month),
  };
}

export async function getClientResults(): Promise<ClientResult[]> {
  const supabase = await createClient();
  /*
   * The default PostgREST page is 1,000 rows and there are 987 clients, which
   * is close enough that a handful of new ones would silently truncate the list.
   */
  const { data, error } = await supabase
    .from("client_results_summary")
    .select("*")
    .order("name")
    .range(0, 4999);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toClient);
}

export async function getClient(id: string): Promise<ClientResult | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_results_summary")
    .select("*")
    .eq("salesforce_client_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toClient(data) : null;
}

export async function getMonths(id: string): Promise<MonthRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_monthly_results")
    .select("*")
    .eq("salesforce_client_id", id)
    .order("month_index");
  if (error) throw new Error(error.message);

  const rows: MonthRow[] = (data ?? []).map((r: any) => ({
    monthIndex: r.month_index,
    monthStart: r.month_start,
    leads: r.leads,
    appointments: r.appointments,
    quotes: r.quotes,
    pos: r.pos,
    quoteAmount: Number(r.quote_amount ?? 0),
    poAmount: Number(r.po_amount ?? 0),
  }));
  if (!rows.length) return rows;

  /*
   * A month with nothing in it produced no row, and a gap in a chart reads as
   * "no data" when what happened was "no results". Fill the run so the shape of
   * a quiet stretch is visible.
   */
  const filled: MonthRow[] = [];
  /*
   * Month one of the engagement, which is not necessarily the first row --
   * a client whose first result landed in month five has no month-one row to
   * read the date off.
   */
  const first = new Date(`${rows[0].monthStart}T00:00:00Z`);
  const start = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - (rows[0].monthIndex - 1), 1),
  );
  const byIndex = new Map(rows.map((r) => [r.monthIndex, r]));
  for (let i = 1; i <= rows[rows.length - 1].monthIndex; i += 1) {
    const existing = byIndex.get(i);
    if (existing) {
      filled.push(existing);
      continue;
    }
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i - 1, 1));
    filled.push({
      monthIndex: i,
      monthStart: d.toISOString().slice(0, 10),
      leads: 0, appointments: 0, quotes: 0, pos: 0, quoteAmount: 0, poAmount: 0,
    });
  }
  return filled;
}
