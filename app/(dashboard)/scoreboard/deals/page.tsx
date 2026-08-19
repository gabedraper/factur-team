import type { ScoreboardPageProps } from "@/lib/scoreboard/page-props";
import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DEAL_PERIODS, DEAL_PERIOD_LABEL, dealPeriodRange, isDealPeriod } from "@/lib/scoreboard/deal-period";
import { companyAverageSplit } from "@/lib/scoreboard/leaderboard-average";
import { FilterNote } from "@/components/scoreboard/FilterNote";
import { ReportSpec } from "@/components/scoreboard/ReportSpec";
import { SourceRecordsBlurb } from "@/components/scoreboard/SourceRecordsBlurb";
import { TeamBlurb } from "@/components/scoreboard/TeamBlurb";
import { MaskedName } from "@/components/scoreboard/MaskedName";
import { MaskedBlurb } from "@/components/scoreboard/MaskedBlurb";
import { VERIFICATION_MODE_ACTIVE } from "@/lib/scoreboard/verification-mode";
import { getViewerRepId } from "@/lib/scoreboard/viewer";

const DEAL_TYPES = ["New Client Deal", "New Customer PO"] as const;

type RepAgg = {
  rep_id: string;
  display_name: string;
  totalPoints: number;
  records: {
    date: string;
    label: string;
    description: string;
    link: string;
    clientName: string | null;
    accountName: string | null;
  }[];
  isManager?: boolean;
  team?: { display_name: string; totalPoints: number }[];
};

export default async function DealsPage(props: ScoreboardPageProps) {
  const sp = await props.searchParams;
  const period = isDealPeriod(sp.period) ? sp.period : "this_year";
  const { start, end } = dealPeriodRange(period);

  const supabase = await createClient();
  const viewerRepId = await getViewerRepId(supabase);
  const [{ data, error }, { data: detail }, { data: repsRows }] = await Promise.all([
    supabase
      .from("deals_leaderboard")
      .select("rep_id, display_name, deal_type, points")
      .in("deal_type", DEAL_TYPES)
      .gte("event_date", start)
      .lte("event_date", end),
    supabase
      .from("deal_activity_detail")
      .select("rep_id, event_date, deal_type, account_name, client_name, sf_link")
      .in("deal_type", DEAL_TYPES)
      .gte("event_date", start)
      .lte("event_date", end)
      .order("event_date", { ascending: false }),
    supabase
      .from("reps")
      .select("id, display_name, salesforce_owner_id, manager_salesforce_id, manager_rep_id")
      .eq("active", true),
  ]);

  const totals = new Map<string, RepAgg>();
  for (const row of data ?? []) {
    const existing = totals.get(row.rep_id) ?? {
      rep_id: row.rep_id,
      display_name: row.display_name,
      totalPoints: 0,
      records: [],
    };
    existing.totalPoints += Number(row.points);
    totals.set(row.rep_id, existing);
  }
  for (const row of detail ?? []) {
    const rep = totals.get(row.rep_id);
    if (rep) {
      rep.records.push({
        date: row.event_date,
        label: row.deal_type,
        description: row.account_name ?? "(no account)",
        link: row.sf_link,
        clientName: row.client_name,
        accountName: row.account_name,
      });
    }
  }

  const repsBySfId = new Map((repsRows ?? []).map((r) => [r.salesforce_owner_id, r]));
  const effectiveManagerId = new Map<string, string>();
  for (const r of repsRows ?? []) {
    const managerId = r.manager_rep_id ?? repsBySfId.get(r.manager_salesforce_id ?? "")?.id;
    if (managerId) effectiveManagerId.set(r.id, managerId);
  }
  const managerRepIds = new Set(effectiveManagerId.values());
  const viewerIsManager = viewerRepId ? managerRepIds.has(viewerRepId) : false;
  const masking = VERIFICATION_MODE_ACTIVE && !viewerIsManager;

  const teamByManagerId = new Map<string, { id: string; display_name: string }[]>();
  for (const r of repsRows ?? []) {
    if (managerRepIds.has(r.id)) continue;
    const managerId = effectiveManagerId.get(r.id);
    if (!managerId) continue;
    const team = teamByManagerId.get(managerId) ?? [];
    team.push({ id: r.id, display_name: r.display_name });
    teamByManagerId.set(managerId, team);
  }

  const managerRows: RepAgg[] = [];
  for (const [managerId, team] of teamByManagerId) {
    const manager = (repsRows ?? []).find((r) => r.id === managerId);
    if (!manager || team.length === 0) continue;
    const teamTotals = team.map((t) => totals.get(t.id)?.totalPoints ?? 0);
    managerRows.push({
      rep_id: `${managerId}-manager`,
      display_name: manager.display_name,
      totalPoints: teamTotals.reduce((s, v) => s + v, 0) / team.length,
      records: [],
      isManager: true,
      team: team.map((t) => ({
        display_name: t.display_name,
        totalPoints: totals.get(t.id)?.totalPoints ?? 0,
      })),
    });
  }

  const ranked = [
    ...Array.from(totals.values()).filter((rep) => !teamByManagerId.has(rep.rep_id)),
    ...managerRows,
  ].sort(
    (a, b) => b.totalPoints - a.totalPoints
  );
  const avgSplit = companyAverageSplit(ranked, (rep) => rep.totalPoints);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Deals</h1>
          <p className="text-sm text-neutral-500">New Customers closed per person</p>
        </div>
        <div className="flex gap-2">
          {DEAL_PERIODS.map((p) => (
            <Link
              key={p}
              href={`/scoreboard/deals?period=${p}`}
              className={`flex items-center justify-center rounded-md px-3 py-1.5 text-center text-sm ${
                period === p
                  ? "bg-white text-neutral-900"
                  : "bg-neutral-900 text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {DEAL_PERIOD_LABEL[p]}
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400">
          Couldn&apos;t load deals: {error.message}
        </p>
      )}

      <ol className="divide-y divide-neutral-900">
        {ranked.map((rep, i) => {
          const isOwnRow = rep.rep_id === viewerRepId;
          const maskRow = masking && !isOwnRow;

          return (
            <Fragment key={rep.rep_id}>
            {avgSplit && i === avgSplit.insertAt && (
              <li className="flex items-center gap-3 py-2">
                <span className="h-px flex-1 bg-neutral-800" />
                <span className="shrink-0 text-xs font-medium text-neutral-500">
                  Company Average — {Math.round(avgSplit.average)}
                </span>
                <span className="h-px flex-1 bg-neutral-800" />
              </li>
            )}
            <li className="group relative flex items-center gap-4 py-3">
              <span className="w-6 text-sm text-neutral-500">{i + 1}</span>
              <span className="flex-1 text-sm">
                {maskRow ? (
                  <MaskedName />
                ) : (
                  <>
                    {rep.display_name}
                    {rep.isManager && (
                      <span className="ml-2 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                        Manager avg
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className="w-16 text-right text-sm font-medium">
                {rep.isManager ? Math.round(rep.totalPoints) : rep.totalPoints}
              </span>
              {maskRow ? (
                <MaskedBlurb side="left" />
              ) : rep.isManager ? (
                <TeamBlurb
                  repName={rep.display_name}
                  team={[...(rep.team ?? [])]
                    .sort((a, b) => b.totalPoints - a.totalPoints)
                    .map((t) => ({
                      display_name: t.display_name,
                      detail: `${t.totalPoints} deal${t.totalPoints === 1 ? "" : "s"}`,
                    }))}
                />
              ) : (
                <SourceRecordsBlurb repName={rep.display_name} records={rep.records} />
              )}
            </li>
            </Fragment>
          );
        })}
        {avgSplit && avgSplit.insertAt === ranked.length && (
          <li className="flex items-center gap-3 py-2">
            <span className="h-px flex-1 bg-neutral-800" />
            <span className="shrink-0 text-xs font-medium text-neutral-500">
              Company Average — {Math.round(avgSplit.average)}
            </span>
            <span className="h-px flex-1 bg-neutral-800" />
          </li>
        )}
        {ranked.length === 0 && !error && (
          <li className="py-6 text-center text-sm text-neutral-500">
            No deals in this period.
          </li>
        )}
      </ol>

      <FilterNote>
        This leaderboard merges two Salesforce reports to combine both teams that close
        new customers.
        <ReportSpec
          title="New Client Deal — Sales (from “Deals by Month”)"
          reportType="Opportunities"
          filters={[
            "Client Start Date is not blank",
            "Client Start Date ≥ 1/1/2025",
            "Client ≠ \"Factur Contract Renewals\"",
            "Opportunity Name does not contain \"payback\"",
            "RG Monthly Revenue is not blank",
            "Service does not contain \"RG\" and does not contain \"Outside\"",
          ]}
          grouping="Opportunity Owner"
          sorting="Client Start Date"
        />
        <ReportSpec
          title="New Customer PO — Client Services (from “New Deals by AM”)"
          reportType="Orders and Client"
          filters={["PO Number = \"1st\" (Salesforce's own first-purchase-order flag)"]}
          grouping="Account Manager"
          sorting="Order Start Date"
        />
        Both feed the same leaderboard, crediting whichever team closed the customer.
        Hovering a row shows the underlying Opportunity or Order records for the
        selected period.
        <br /><br />
        Managers (from Salesforce Manager, or Manager (Text) as a fallback when Manager
        isn&apos;t set) show a &quot;Manager avg&quot; row instead of their own personal
        deal count: the average deals closed across their active direct reports for the
        selected period. Reports who are themselves managers aren&apos;t counted in a
        higher-level manager&apos;s average. Hovering a manager row shows their team and
        each person&apos;s own count.
        <br /><br />
        The &quot;Company Average&quot; divider splits the list at the mean total
        (including manager-average rows) across everyone shown for the selected period.
      </FilterNote>
    </div>
  );
}
