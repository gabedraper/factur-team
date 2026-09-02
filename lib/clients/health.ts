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
 * The five measures as one line, in the order they happen: we hand over an
 * RFQ, they quote it, they win it, and all the while they answer or they do
 * not. Only what the client has data for -- a client on a service that never
 * quotes should not read as though it quoted nothing.
 */
function performanceDetail(p: Perf | undefined): string {
  if (!p) return "nothing to measure yet";
  const parts: string[] = [];
  const turn = days(p.turnaround_days);
  if (turn) parts.push(`quotes in ${turn}`);
  if (p.quote_rate !== null) parts.push(`${Math.round(p.quote_rate)}% of ${p.presented} RFQs quoted`);
  if (p.win_rate !== null) parts.push(`${Math.round(p.win_rate)}% won`);
  const resp = days(p.response_days);
  if (resp) parts.push(`replies in ${resp}`);
  if (p.dm_involved !== null) parts.push(p.dm_involved ? "DM engaged" : "DM absent");
  return parts.length ? parts.join(" · ") : "nothing to measure yet";
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
  const [{ data, error }, { data: perf }] = await Promise.all([
    supabase.rpc("get_client_health"),
    /*
     * The Client Performance detail. Fetched apart rather than widening
     * get_client_health's return type, which would mean rewriting five
     * kilobytes of scoring logic to add five display-only columns.
     */
    supabase.from("client_performance_by_client").select("*"),
  ]);
  if (error) throw new Error(`client health query failed: ${error.message}`);

  const perfByClient = new Map<string, Perf>(
    ((perf ?? []) as Perf[]).map((p) => [p.client_id, p]),
  );

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
          detail:
            r.nps_latest === null
              ? "not surveyed yet"
              : `${r.nps_latest}/10` +
                (r.nps_previous === null ? " (first)" : `, was ${r.nps_previous}`),
        },
        {
          key: "engagement",
          label: "Client Performance",
          score: r.engagement_score,
          detail: performanceDetail(perfByClient.get(r.client_id)),
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
