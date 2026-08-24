import { createServiceClient } from "@/lib/supabase/server";
import type { ClientHealth } from "./health-score";

export * from "./health-score";

type Row = {
  client_id: string; client_name: string; status: string | null;
  account_manager: string | null; manual_health: string | null;
  leads_30d: number; leads_prior_30d: number; lead_flow_score: number | null;
  activities_30d: number; activities_prior_30d: number; activity_score: number | null;
  nps_latest: number | null; nps_previous: number | null; nps_on: string | null;
  nps_score: number | null;
  quoted: number; no_quoted: number; dm_known: number | null;
  engagement_score: number | null;
  open_balance: number | null; days_since_payment: number | null;
  receivables_score: number | null;
  inputs_measured: number; overall_score: number | null;
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
  const { data, error } = await createServiceClient().rpc("get_client_health");
  if (error) throw new Error(`client health query failed: ${error.message}`);

  return ((data ?? []) as Row[])
    .map((r) => ({
      clientId: r.client_id,
      name: r.client_name,
      status: r.status,
      accountManager: r.account_manager,
      manualHealth: r.manual_health,
      overall: r.overall_score,
      inputsMeasured: r.inputs_measured,
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
          label: "Engagement",
          score: r.engagement_score,
          detail:
            r.quoted + r.no_quoted > 0
              ? `${r.quoted} quoted, ${r.no_quoted} not` +
                (r.dm_known !== null ? ` · DM named on ${r.dm_known}%` : "")
              : r.dm_known !== null
                ? `DM named on ${r.dm_known}% of leads`
                : "no quoting decisions yet",
        },
        {
          key: "receivables",
          label: "Receivables",
          score: r.receivables_score,
          detail:
            r.open_balance === null
              ? "no balance on file"
              : r.open_balance <= 0
                ? "nothing outstanding"
                : `${money.format(r.open_balance)} outstanding` +
                  (r.days_since_payment === null
                    ? ", no payment recorded"
                    : `, paid ${r.days_since_payment}d ago`),
        },
      ],
    }))
    // Worst first: this screen exists to surface the clients in trouble, and a
    // client with nothing measured is not evidence of health, so it sorts last.
    .sort((a, b) => {
      if (a.overall === null) return b.overall === null ? 0 : 1;
      if (b.overall === null) return -1;
      return a.overall - b.overall;
    });
}
