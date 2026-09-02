import { createClient } from "@/lib/supabase/server";
import type { ClientHealth } from "./health-score";
import { terciles } from "./health-score";

export * from "./health-score";

type Row = {
  client_id: string; client_name: string; status: string | null;
  account_manager: string | null; team_lead: string | null; manual_health: string | null;
  leads_30d: number; leads_prior_30d: number; lead_flow_score: number | null;
  activities_30d: number; activities_prior_30d: number; activity_score: number | null;
  nps_latest: number | null; nps_previous: number | null; nps_on: string | null;
  nps_score: number | null;
  quoted: number; no_quoted: number; dm_known: number | null;
  engagement_score: number | null;
  ar_total: number | null; ar_owed: number | null; ar_credits: number | null;
  ar_overdue_60_plus: number | null;
  ar_current: number | null; ar_1_30: number | null; ar_31_60: number | null;
  ar_61_90: number | null; ar_91_plus: number | null;
  collections_stage: string | null;
  receivables_score: number | null;
  inputs_measured: number; overall_score: number | null;
};

type NpsRow = { client_id: string; score: number; collected_on: string };
type MonthRow = { client_id: string; month_start: string; activities: number };
type LeadMonthRow = {
  client_id: string; month_start: string; leads: number;
  source: "daily" | "backfill"; computed_at: string;
};

const asOfLabel = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});

const npsMonth = new Intl.DateTimeFormat("en-US", {
  month: "short", year: "numeric", timeZone: "UTC",
});

type Perf = {
  client_id: string;
  turnaround_days: number | null; turnaround_n: number;
  quote_rate: number | null; presented: number; submitted: number;
  win_rate: number | null; won: number; lost: number;
  response_days: number | null; response_n: number;
  dm_involved: boolean | null; dm_touches: number;
};

/** "3.5 days", "1 day" -- days rounded to one place, pluralised. */
function days(value: number | null): string | null {
  if (value === null) return null;
  const n = Math.round(value * 10) / 10;
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * Where one measure sits against every client that has it.
 *
 * Each measure is ranked on its own scale -- a 44% quote rate and a 12 day
 * turnaround have nothing in common but their position in the book -- and the
 * two speed measures are inverted, since fewer days is better.
 */
function toneFor(
  value: number | null,
  bands: [number, number] | null,
  lowerIsBetter = false,
): "good" | "warning" | "critical" | undefined {
  if (value === null || !bands) return undefined;
  const [lo, hi] = bands;
  if (lowerIsBetter) {
    if (value <= lo) return "good";
    return value <= hi ? "warning" : "critical";
  }
  if (value > hi) return "good";
  return value > lo ? "warning" : "critical";
}

/**
 * The five measures as rows, in the order they happen: we hand over an RFQ,
 * they quote it, they win it, and all the while they answer or they do not.
 *
 * Only what the client has data for -- a client on a service that never quotes
 * should not read as though it quoted nothing, so a missing measure is left
 * out rather than shown as a dash.
 */
function performanceRows(
  p: Perf | undefined,
  bands: PerfBands,
): NonNullable<ClientHealth["inputs"][number]["rows"]> {
  if (!p) return [];
  const rows: NonNullable<ClientHealth["inputs"][number]["rows"]> = [];
  const turn = days(p.turnaround_days);
  if (turn) {
    rows.push({
      label: "Quote turnaround", value: turn,
      tone: toneFor(p.turnaround_days, bands.turnaround, true),
    });
  }
  if (p.quote_rate !== null) {
    rows.push({
      label: "Quote rate", value: `${Math.round(p.quote_rate)}% of ${p.presented}`,
      tone: toneFor(p.quote_rate, bands.quoteRate),
    });
  }
  if (p.win_rate !== null) {
    rows.push({
      label: "Win rate", value: `${Math.round(p.win_rate)}% of ${p.won + p.lost}`,
      tone: toneFor(p.win_rate, bands.winRate),
    });
  }
  const resp = days(p.response_days);
  if (resp) {
    rows.push({
      label: "Responds in", value: resp,
      tone: toneFor(p.response_days, bands.response, true),
    });
  }
  if (p.dm_involved !== null) {
    // Not a ranking: the decision maker is either in the correspondence or not.
    rows.push({
      label: "Decision maker",
      value: p.dm_involved ? "Engaged" : "Absent",
      tone: p.dm_involved ? "good" : "critical",
    });
  }
  return rows;
}

type PerfBands = {
  turnaround: [number, number] | null;
  quoteRate: [number, number] | null;
  winRate: [number, number] | null;
  response: [number, number] | null;
};

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** How a count moved against the month before it, in words. */
function movement(now: number, before: number, noun: string): string {
  if (!now && !before) return `no ${noun}`;
  if (!before) return `${nf.format(now)} ${noun}, none the month before`;
  return `${nf.format(now)} vs ${nf.format(before)} ${noun} last month`;
}

export async function getClientHealth(): Promise<ClientHealth[]> {
  // The signed-in person's own connection, not the service key: the function
  // checks is_factur_user(), which reads the email out of their token. Asked
  // with the service key there is no token to read, so it would answer "not a
  // Factur user" and return nothing at all.
  const supabase = await createClient();
  const [{ data, error }, { data: perf }, { data: nps }, { data: months }, { data: leadMonths }] =
    await Promise.all([
    supabase.rpc("get_client_health"),
    /*
     * The Client Performance detail. Fetched apart rather than widening
     * get_client_health's return type, which would mean rewriting five
     * kilobytes of scoring logic to add five display-only columns.
     */
    supabase.from("client_performance_by_client").select("*"),
    /*
     * Every NPS response, so the card can show the whole series rather than
     * the latest and the one before it. Fifteen rows today; one survey per
     * client so far, and this is what will show a trend once there are more.
     */
    supabase.from("client_nps").select("client_id,score,collected_on")
      .order("collected_on", { ascending: false }),
    /*
     * Activity by month. raw_activities accumulates rather than rolling, so
     * this deepens on its own -- about ten weeks today.
     */
    supabase.from("client_activity_months_by_client")
      .select("client_id,month_start,activities")
      .order("month_start", { ascending: false }),
    /*
     * Leads by calendar month. From client_monthly_results, which is the
     * definition Client Results settled on -- delivered opportunities, plus
     * anything carrying quote or PO evidence.
     */
    supabase.from("client_lead_months_by_client")
      .select("client_id,month_start,leads,source,computed_at")
      .order("month_start", { ascending: false }),
  ]);
  if (error) throw new Error(`client health query failed: ${error.message}`);

  /*
   * Bands per measure, over every client that has one -- not over the page,
   * so a client's colour means the same wherever it is seen.
   */
  const allPerf = (perf ?? []) as Perf[];
  const perfBands: PerfBands = {
    turnaround: terciles(allPerf.map((p) => p.turnaround_days)),
    quoteRate: terciles(allPerf.map((p) => p.quote_rate)),
    winRate: terciles(allPerf.map((p) => p.win_rate)),
    response: terciles(allPerf.map((p) => p.response_days)),
  };

  const perfByClient = new Map<string, Perf>(
    allPerf.map((p) => [p.client_id, p]),
  );

  const npsByClient = new Map<string, { label: string; value: string }[]>();
  for (const n of (nps ?? []) as NpsRow[]) {
    const rows = npsByClient.get(n.client_id) ?? [];
    rows.push({ label: npsMonth.format(new Date(`${n.collected_on}T00:00:00Z`)),
                value: `${n.score}/10` });
    npsByClient.set(n.client_id, rows);
  }

  /*
   * Each month ranked against the same month for every other client, so a
   * quiet August is judged against everyone else's August rather than against
   * a busy March.
   */
  const leadRows = (leadMonths ?? []) as LeadMonthRow[];
  const leadBandsByMonth = new Map<string, [number, number] | null>();
  for (const m of leadRows) {
    if (!leadBandsByMonth.has(m.month_start)) {
      leadBandsByMonth.set(
        m.month_start,
        terciles(leadRows.filter((x) => x.month_start === m.month_start).map((x) => x.leads)),
      );
    }
  }

  /*
   * When the numbers were last worked out. Daily for the clients Coupler
   * syncs; for the rest it is whenever the Salesforce backfill last ran, which
   * is worth saying rather than implying every number is from this morning.
   */
  const asOfByClient = new Map<string, string>();
  for (const m of leadRows) {
    if (asOfByClient.has(m.client_id)) continue;
    asOfByClient.set(
      m.client_id,
      m.source === "daily"
        ? `as of ${asOfLabel.format(new Date(m.computed_at))}`
        : "as of the last backfill",
    );
  }

  const leadsByClient = new Map<string, NonNullable<ClientHealth["inputs"][number]["rows"]>>();
  for (const m of leadRows) {
    const rows = leadsByClient.get(m.client_id) ?? [];
    rows.push({
      label: npsMonth.format(new Date(`${m.month_start}T00:00:00Z`)),
      value: nf.format(m.leads),
      href: `/clients/${m.client_id}/leads?month=${m.month_start.slice(0, 7)}`,
      tone: toneFor(m.leads, leadBandsByMonth.get(m.month_start) ?? null),
    });
    leadsByClient.set(m.client_id, rows);
  }

  const monthsByClient = new Map<string, { label: string; value: string; href: string }[]>();
  for (const m of (months ?? []) as MonthRow[]) {
    const rows = monthsByClient.get(m.client_id) ?? [];
    rows.push({
      label: npsMonth.format(new Date(`${m.month_start}T00:00:00Z`)),
      value: nf.format(m.activities),
      href: `/clients/${m.client_id}/activities?month=${m.month_start.slice(0, 7)}`,
    });
    monthsByClient.set(m.client_id, rows);
  }

  return ((data ?? []) as Row[])
    .map((r) => ({
      clientId: r.client_id,
      name: r.client_name,
      status: r.status,
      accountManager: r.account_manager,
      teamLead: r.team_lead,
      manualHealth: r.manual_health,
      overall: r.overall_score,
      inputsMeasured: r.inputs_measured,
      ageing:
        r.ar_total === null
          ? null
          : {
              current: Number(r.ar_current ?? 0),
              b1_30: Number(r.ar_1_30 ?? 0),
              b31_60: Number(r.ar_31_60 ?? 0),
              b61_90: Number(r.ar_61_90 ?? 0),
              b91_plus: Number(r.ar_91_plus ?? 0),
            },
      collectionsStage: r.collections_stage,
      inputs: [
        {
          key: "lead_flow",
          label: "Lead flow",
          score: r.lead_flow_score,
          detail: asOfByClient.get(r.client_id) ?? "",
          rows: leadsByClient.get(r.client_id) ?? [],
        },
        {
          key: "activity",
          label: "AM activity",
          score: r.activity_score,
          detail: "",
          rows: monthsByClient.get(r.client_id) ?? [],
        },
        {
          key: "nps",
          label: "NPS",
          score: r.nps_score,
          // Every survey, newest first. Blank rather than "not surveyed yet"
          // when there are none -- an empty card says that already.
          detail: "",
          rows: npsByClient.get(r.client_id) ?? [],
        },
        {
          key: "engagement",
          label: "Client Performance",
          score: r.engagement_score,
          detail: "",
          rows: performanceRows(perfByClient.get(r.client_id), perfBands),
        },
        {
          key: "receivables",
          label: "Receivables",
          score: r.receivables_score,
          /*
           * Empty on purpose. The card shows the five ageing buckets and the
           * stage now, which is the same money the sentence was summarising --
           * and the collections board already shows it that way.
           */
          detail: "",
        },
      ],
    }));
}
