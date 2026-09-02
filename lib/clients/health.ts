import { createClient } from "@/lib/supabase/server";
import type { ClientHealth } from "./health-score";

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
 * The five measures as rows, in the order they happen: we hand over an RFQ,
 * they quote it, they win it, and all the while they answer or they do not.
 *
 * Only what the client has data for -- a client on a service that never quotes
 * should not read as though it quoted nothing, so a missing measure is left
 * out rather than shown as a dash.
 */
function performanceRows(p: Perf | undefined): { label: string; value: string }[] {
  if (!p) return [];
  const rows: { label: string; value: string }[] = [];
  const turn = days(p.turnaround_days);
  if (turn) rows.push({ label: "Quote turnaround", value: turn });
  if (p.quote_rate !== null) {
    rows.push({ label: "Quote rate", value: `${Math.round(p.quote_rate)}% of ${p.presented}` });
  }
  if (p.win_rate !== null) {
    rows.push({ label: "Win rate", value: `${Math.round(p.win_rate)}% of ${p.won + p.lost}` });
  }
  const resp = days(p.response_days);
  if (resp) rows.push({ label: "Responds in", value: resp });
  if (p.dm_involved !== null) {
    rows.push({ label: "Decision maker", value: p.dm_involved ? "Engaged" : "Absent" });
  }
  return rows;
}

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
  const [{ data, error }, { data: perf }, { data: nps }] = await Promise.all([
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
  ]);
  if (error) throw new Error(`client health query failed: ${error.message}`);

  const perfByClient = new Map<string, Perf>(
    ((perf ?? []) as Perf[]).map((p) => [p.client_id, p]),
  );

  const npsByClient = new Map<string, { label: string; value: string }[]>();
  for (const n of (nps ?? []) as NpsRow[]) {
    const rows = npsByClient.get(n.client_id) ?? [];
    rows.push({ label: npsMonth.format(new Date(`${n.collected_on}T00:00:00Z`)),
                value: `${n.score}/10` });
    npsByClient.set(n.client_id, rows);
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
          detail: movement(r.leads_30d, r.leads_prior_30d, "leads"),
        },
        {
          key: "activity",
          label: "AM activity",
          score: r.activity_score,
          detail: movement(r.activities_30d, r.activities_prior_30d, "activities"),
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
          rows: performanceRows(perfByClient.get(r.client_id)),
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
