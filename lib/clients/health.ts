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

/**
 * What a client's receivables actually say, in a line.
 *
 * Owed and credits are reported apart rather than netted, because a client who
 * owes $8,000 and holds a $5,500 credit is not a client who owes $2,500 -- one
 * of those is a conversation about an unapplied payment and the other is not.
 */
function receivablesDetail(r: Row): string {
  if (r.ar_total === null) return "not matched in QuickBooks";

  const owed = Number(r.ar_owed ?? 0);
  const credits = Number(r.ar_credits ?? 0);
  const past60 = Number(r.ar_overdue_60_plus ?? 0);

  if (owed <= 0) {
    return credits > 0 ? `${money.format(credits)} in credit` : "nothing outstanding";
  }

  return [
    `${money.format(owed)} owed`,
    credits > 0 ? `${money.format(credits)} in credits` : null,
    past60 > 0 ? `${money.format(past60)} past 60 days` : "none past 60 days",
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function getClientHealth(): Promise<ClientHealth[]> {
  // The signed-in person's own connection, not the service key: the function
  // checks is_factur_user(), which reads the email out of their token. Asked
  // with the service key there is no token to read, so it would answer "not a
  // Factur user" and return nothing at all.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_client_health");
  if (error) throw new Error(`client health query failed: ${error.message}`);

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
          detail: receivablesDetail(r),
        },
      ],
    }));
}
