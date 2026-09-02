import { createClient } from "@/lib/supabase/server";
import type { ClientResult, MonthRow, ServiceSeries, ServicePeriod } from "./result-metrics";
import { serviceHeadline } from "./result-metrics";

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
    products: [],
    equipment: [],
    extraServices: [],
    materials: r.materials ?? [],
    certifications: r.certifications ?? [],
    marketsServed: r.markets_served ?? [],
    employees: r.employees,
    sizeBand: r.size_band,
    sizeInferred: Boolean(r.size_inferred),
    industry: r.industry,
    summary: r.summary,
    servicesDelivered: r.services_delivered ?? [],
    busiestService: r.busiest_service ?? null,
    multiService: Boolean(r.multi_service),
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

/*
 * What each client's website says they do, fetched alongside rather than joined
 * into client_results_summary.
 *
 * That view is long and several pages depend on it; adding a filter was not a
 * reason to rewrite it. Two queries and a merge is duller and cannot break the
 * numbers.
 */
type AttributeLists = {
  salesforce_client_id: string;
  capabilities: string[] | null;
  products: string[] | null;
  certifications: string[] | null;
  materials: string[] | null;
  markets_served: string[] | null;
  equipment: string[] | null;
  extra_services: string[] | null;
};

async function attributeLists(): Promise<Map<string, AttributeLists>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_attribute_lists").select("*").range(0, 4999);
  return new Map(
    ((data ?? []) as AttributeLists[]).map((r) => [r.salesforce_client_id, r])
  );
}

function withAttributes(client: ClientResult, lists: AttributeLists | undefined): ClientResult {
  if (!lists) return client;
  return {
    ...client,
    // The website reading wins where it has something. The old columns it
    // replaces were never filled in, so this is not a contest -- but written
    // as one so a half-populated client still shows whatever it has.
    capabilities: lists.capabilities ?? client.capabilities,
    certifications: lists.certifications ?? client.certifications,
    materials: lists.materials ?? client.materials,
    marketsServed: lists.markets_served ?? client.marketsServed,
    products: lists.products ?? [],
    equipment: lists.equipment ?? [],
    extraServices: lists.extra_services ?? [],
  };
}

export async function getClientResults(): Promise<ClientResult[]> {
  const supabase = await createClient();
  /*
   * The default PostgREST page is 1,000 rows and there are 987 clients, which
   * is close enough that a handful of new ones would silently truncate the list.
   */
  const [{ data, error }, lists] = await Promise.all([
    supabase.from("client_results_summary").select("*").order("name").range(0, 4999),
    attributeLists(),
  ]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => withAttributes(toClient(r), lists.get(r.salesforce_client_id)));
}

export async function getClient(id: string): Promise<ClientResult | null> {
  const supabase = await createClient();
  const [{ data, error }, { data: lists }] = await Promise.all([
    supabase.from("client_results_summary").select("*")
      .eq("salesforce_client_id", id).maybeSingle(),
    supabase.from("client_attribute_lists").select("*")
      .eq("salesforce_client_id", id).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  return data ? withAttributes(toClient(data), (lists as AttributeLists | null) ?? undefined) : null;
}

export async function getServicePeriods(id: string): Promise<ServicePeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_service_periods")
    .select("id,service,started_on,ended_on,monthly_rate,tier,note,source")
    .eq("salesforce_client_id", id)
    .order("started_on");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    service: r.service,
    startedOn: r.started_on,
    endedOn: r.ended_on,
    monthlyRate: r.monthly_rate === null ? null : Number(r.monthly_rate),
    tier: r.tier,
    note: r.note,
    source: r.source,
  }));
}

/**
 * A client's months, one run per service.
 *
 * Split rather than pooled because a client who moved from OP to LG is judged
 * on quotes for the first stretch and leads for the second, and one column of
 * numbers cannot say that.
 */
export async function getServiceSeries(id: string): Promise<ServiceSeries[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_monthly_results")
    .select("*")
    .eq("salesforce_client_id", id)
    .order("month_index");
  if (error) throw new Error(error.message);

  const rows: MonthRow[] = (data ?? []).map((r: any) => ({
    service: r.service,
    monthIndex: r.month_index,
    monthStart: r.month_start,
    leads: r.leads,
    appointments: r.appointments,
    quotes: r.quotes,
    pos: r.pos,
    quoteAmount: Number(r.quote_amount ?? 0),
    poAmount: Number(r.po_amount ?? 0),
  }));
  if (!rows.length) return [];

  const byService = new Map<string, MonthRow[]>();
  for (const r of rows) {
    const list = byService.get(r.service) ?? [];
    list.push(r);
    byService.set(r.service, list);
  }

  const series: ServiceSeries[] = [];
  for (const [service, months] of byService) {
    months.sort((a, b) => a.monthIndex - b.monthIndex);

    /*
     * A month that produced nothing has no row, and a gap reads as "no data"
     * when what happened was "no results". Fill from this service's first
     * month to its last -- not from month one, because a service the client
     * only took up in year two did not have a quiet first year, it had none.
     */
    const first = new Date(`${months[0].monthStart}T00:00:00Z`);
    const byIndex = new Map(months.map((m) => [m.monthIndex, m]));
    const filled: MonthRow[] = [];
    for (let i = months[0].monthIndex; i <= months[months.length - 1].monthIndex; i += 1) {
      const existing = byIndex.get(i);
      if (existing) {
        filled.push(existing);
        continue;
      }
      const d = new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + (i - months[0].monthIndex), 1),
      );
      filled.push({
        service, monthIndex: i, monthStart: d.toISOString().slice(0, 10),
        leads: 0, appointments: 0, quotes: 0, pos: 0, quoteAmount: 0, poAmount: 0,
      });
    }

    series.push({
      service,
      headline: serviceHeadline(service),
      months: filled,
      totals: filled.reduce(
        (a, m) => ({
          leads: a.leads + m.leads,
          appointments: a.appointments + m.appointments,
          quotes: a.quotes + m.quotes,
          quoteAmount: a.quoteAmount + m.quoteAmount,
          pos: a.pos + m.pos,
          poAmount: a.poAmount + m.poAmount,
        }),
        { leads: 0, appointments: 0, quotes: 0, quoteAmount: 0, pos: 0, poAmount: 0 },
      ),
    });
  }

  // Busiest first, so the service that defined the engagement leads the page.
  return series.sort((a, b) => b.totals.leads - a.totals.leads);
}
