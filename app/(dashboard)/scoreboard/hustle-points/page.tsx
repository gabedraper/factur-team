import type { ScoreboardPageProps } from "@/lib/scoreboard/page-props";
import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateRangeLabel } from "@/lib/scoreboard/date-range";
import { HIDDEN_EFFORT_SOURCES, sortByEffortCategory } from "@/lib/scoreboard/effort-weights";
import { FilterNote } from "@/components/scoreboard/FilterNote";
import { ReportSpec } from "@/components/scoreboard/ReportSpec";
import { TeamBlurb } from "@/components/scoreboard/TeamBlurb";
import { MaskedName } from "@/components/scoreboard/MaskedName";
import { MaskedBlurb } from "@/components/scoreboard/MaskedBlurb";
import { VERIFICATION_MODE_ACTIVE } from "@/lib/scoreboard/verification-mode";
import { getViewerRepId } from "@/lib/scoreboard/viewer";
import {
  buildPeriodButtons,
  defaultPeriodKey,
  isValidPeriodKey,
  rangeForPeriodKey,
} from "@/lib/scoreboard/hustle-period";
import { companyAverageSplit } from "@/lib/scoreboard/leaderboard-average";

const BUCKETS = [
  "Calls",
  "Manual Emails",
  "Automated Emails",
  "Client Meetings",
  "Prospect Meetings",
] as const;
type Bucket = (typeof BUCKETS)[number];

const BUCKET_FOR_SOURCE: Record<string, Bucket> = {
  "Manual Call": "Calls",
  "Automated Call (Power Dialer)": "Calls",
  "Automated Call (Parallel Dialer)": "Calls",
  "Manual SMS": "Calls",
  "Sequence Email (Automated Send)": "Automated Emails",
  "Manual Email": "Manual Emails",
  "Client Meeting (Check-In)": "Client Meetings",
  "Prospect Meeting": "Prospect Meetings",
};

type ActivityRecord = {
  activity_date: string;
  category: string;
  subject: string | null;
  sf_link: string | null;
};

type RepAgg = {
  rep_id: string;
  display_name: string;
  totalPoints: number;
  counts: Record<Bucket, number>;
  records: ActivityRecord[];
  isManager?: boolean;
  team?: { display_name: string; totalPoints: number }[];
};

export default async function HustlePointsPage(
  props: ScoreboardPageProps
) {
  const sp = await props.searchParams;
  const periodKey =
    typeof sp.period === "string" && isValidPeriodKey(sp.period)
      ? sp.period
      : defaultPeriodKey();

  const { start, end } = rangeForPeriodKey(periodKey);
  const periodButtons = buildPeriodButtons();

  const supabase = await createClient();
  const viewerRepId = await getViewerRepId(supabase);
  const [{ data, error }, { data: weights }, { data: detailJson }, { data: repsRows }] =
    await Promise.all([
      supabase.rpc("get_hustle_leaderboard_by_source", { p_start: start, p_end: end }),
      supabase
        .from("effort_weights")
        .select("effort_source, points"),
      supabase.rpc("get_rep_activity_detail", { p_start: start, p_end: end }),
      supabase
        .from("reps")
        .select("id, display_name, salesforce_owner_id, manager_salesforce_id, manager_rep_id")
        .eq("active", true),
    ]);
  const sortedWeights = sortByEffortCategory(weights ?? []);
  const detail = (detailJson ?? []) as (ActivityRecord & { rep_id: string })[];

  const totals = new Map<string, RepAgg>();

  for (const row of data ?? []) {
    const existing = totals.get(row.rep_id) ?? {
      rep_id: row.rep_id,
      display_name: row.display_name,
      totalPoints: 0,
      counts: {
        Calls: 0,
        "Manual Emails": 0,
        "Automated Emails": 0,
        "Client Meetings": 0,
        "Prospect Meetings": 0,
      },
      records: [],
    };
    existing.totalPoints += Number(row.points);
    const bucket = BUCKET_FOR_SOURCE[row.effort_source];
    if (bucket) existing.counts[bucket] += row.activity_count;
    totals.set(row.rep_id, existing);
  }

  for (const row of detail) {
    const rep = totals.get(row.rep_id);
    if (!rep) continue;
    rep.records.push(row);
  }

  const repsBySfId = new Map((repsRows ?? []).map((r) => [r.salesforce_owner_id, r]));
  // Manual override takes priority (e.g. shared Salesforce license, no clean Owner chain).
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
    // A manager's own reports don't roll up into whoever THEY report to.
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
    const teamAggs = team.map((t) => totals.get(t.id));
    const avgCounts = {} as Record<Bucket, number>;
    for (const b of BUCKETS) {
      avgCounts[b] = teamAggs.reduce((s, a) => s + (a?.counts[b] ?? 0), 0) / team.length;
    }
    managerRows.push({
      rep_id: `${managerId}-manager`,
      display_name: manager.display_name,
      totalPoints: teamAggs.reduce((s, a) => s + (a?.totalPoints ?? 0), 0) / team.length,
      counts: avgCounts,
      records: [],
      isManager: true,
      team: team.map((t) => ({
        display_name: t.display_name,
        totalPoints: totals.get(t.id)?.totalPoints ?? 0,
      })),
    });
  }

  // Managers with an active team show only their team-average row, not their own
  // personal activity as a second, competing entry.
  const ranked = [
    ...Array.from(totals.values()).filter((rep) => !teamByManagerId.has(rep.rep_id)),
    ...managerRows,
  ].sort((a, b) => b.totalPoints - a.totalPoints);
  const avgSplit = companyAverageSplit(ranked, (rep) => rep.totalPoints);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 group relative inline-block">
        <h1 className="cursor-default text-xl font-semibold">Hustle Points</h1>

        <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 w-56 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          <p className="mb-2 font-medium uppercase tracking-wide text-neutral-500">
            Points per activity
          </p>
          {sortedWeights
            .filter((w) => !HIDDEN_EFFORT_SOURCES.has(w.effort_source))
            .map((w) => (
            <div
              key={w.effort_source}
              className="flex items-center justify-between gap-2 py-0.5 text-neutral-400"
            >
              <span className="truncate">{w.effort_source}</span>
              <span className="shrink-0 font-medium text-neutral-300">
                {Number(w.points).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {periodButtons.map((btn) => (
          <Link
            key={btn.key}
            href={`/scoreboard/hustle-points?period=${btn.key}`}
            className={`flex items-center justify-center rounded-md px-3 py-1.5 text-center text-sm ${
              periodKey === btn.key
                ? "bg-white text-neutral-900"
                : "bg-neutral-900 text-neutral-400 hover:text-neutral-100"
            }`}
          >
            {btn.label}
          </Link>
        ))}
      </div>

      <p className="mb-6 flex items-center justify-end gap-3 text-right text-xs text-neutral-500">
        <a
          href="https://app.coupler.io/app/dataflows/32e79f15-7a56-4018-9493-5fe58138e8d4/edit"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted hover:text-neutral-300"
        >
          Source report ↗
        </a>
        <span>{formatDateRangeLabel(start, end)}</span>
      </p>

      {error && (
        <p className="text-sm text-red-400">
          Couldn&apos;t load the leaderboard: {error.message}
        </p>
      )}

      <div>
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
              <li
                className="group relative flex items-center gap-4 py-3"
              >
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
                  {Math.round(rep.totalPoints)}
                </span>

                {/* Left side, team-visible: source records, or team list for managers */}
                {maskRow ? (
                  <MaskedBlurb side="left" />
                ) : rep.isManager ? (
                  <TeamBlurb
                    repName={rep.display_name}
                    team={[...(rep.team ?? [])]
                      .sort((a, b) => b.totalPoints - a.totalPoints)
                      .map((t) => ({
                        display_name: t.display_name,
                        detail: `${Math.round(t.totalPoints)} pts`,
                      }))}
                  />
                ) : (
                  <div className="pointer-events-none absolute right-full top-1/2 z-10 -translate-y-1/2 pr-3 group-hover:pointer-events-auto">
                    <div className="relative max-h-96 w-[28rem] overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      <div className="absolute -right-1 top-8 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t border-neutral-800 bg-neutral-900" />
                      <p className="sticky top-0 mb-2 bg-neutral-900 pb-1 font-medium text-neutral-100">
                        {rep.display_name} — {rep.records.length} record
                        {rep.records.length === 1 ? "" : "s"}
                      </p>
                      {rep.records.map((row, idx) => (
                        <a
                          key={idx}
                          href={row.sf_link ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 border-t border-neutral-800 py-1.5 first:border-t-0 hover:bg-neutral-800"
                        >
                          <span className="shrink-0 text-neutral-500">{row.activity_date}</span>
                          <span className="shrink-0 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                            {row.category}
                          </span>
                          <span className="truncate text-neutral-300">{row.subject ?? "(no subject)"}</span>
                        </a>
                      ))}
                      {rep.records.length === 0 && (
                        <p className="py-2 text-neutral-500">No records in this period.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Calculation breakdown -- right side */}
                {maskRow ? (
                  <MaskedBlurb side="right" />
                ) : (
                  <div className="pointer-events-none absolute left-full top-1/2 z-10 -translate-y-1/2 pl-3">
                    <div className="relative w-56 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      <div className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-neutral-800 bg-neutral-900" />
                      <p className="mb-2 truncate font-medium text-neutral-100">
                        {rep.display_name}
                      </p>
                      {BUCKETS.map((b) => (
                        <div key={b} className="flex justify-between py-0.5 text-neutral-400">
                          <span>{b}</span>
                          <span>{rep.isManager ? Math.round(rep.counts[b]) : rep.counts[b]}</span>
                        </div>
                      ))}
                      <div className="mt-1 flex justify-between border-t border-neutral-800 pt-1 font-medium text-neutral-100">
                        <span>{rep.isManager ? "Team Avg Points" : "Hustle Points"}</span>
                        <span>{rep.totalPoints.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
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
              No activity in this period.
            </li>
          )}
        </ol>
      </div>

      <FilterNote>
        <ReportSpec
          title="Calls, SMS &amp; Emails"
          reportType="Tasks"
          filters={[
            "Activity Date = selected period",
            "Owner = active rep",
            "Then bucket by Task Subtype / Type / Description / Subject / Email Category:",
            "Task Subtype = Call, Description contains \"[Orum] ... (power)\" → Automated Call (Power Dialer)",
            "Task Subtype = Call, Description contains \"[Orum] ... (parallel)\" → Automated Call (Parallel Dialer)",
            "Task Subtype = Call, Description contains \"[Orum] ... (inbound)\" → excluded (Orum-logged inbound, not a rep-dialed call)",
            "Task Subtype = Call, no [Orum] tag → Manual Call",
            "Type = SMS → Manual SMS",
            "Task Subtype = Email, Email Category = Send, Subject contains a [bracket] tag → Sequence Email (Automated Send)",
            "Task Subtype = Email, Email Category = Send, Subject contains \"invitation\" → excluded (Calendar Invite)",
            "Task Subtype = Email, Email Category = Send, no tag → Manual Email",
            "Email Category = Received / Automatic Reply / Bounced-Undeliverable → excluded (no rep effort)",
          ]}
          grouping="Owner"
          sorting="Activity Date"
        />
        <ReportSpec
          title="Meetings"
          reportType="Events"
          filters={[
            "Activity Date = selected period",
            "Owner = active rep",
            "Then bucket by Subject / Account:",
            "Subject is only an email address, or contains \"Prayer\" → excluded (Excluded Meeting)",
            "Subject is a calendar-block label (Lunch, Block, Hold, OOO, Focus Time, PTO, etc.) or a personal appointment (Dr Appt, Dentist, Haircut) → excluded",
            "Subject matches a known internal-meeting pattern (team huddle, 1:1, payroll, office day, weekly team meeting, pod check, etc.) → Internal Meeting",
            "Subject names two different active reps (e.g. \"Bre & Josh Check-in\") → Internal Meeting",
            "Account Name = \"Factur\" or \"Facturmg.com\" → Internal Meeting",
            "Account has a related Clients__c record with Client Status = Active, Onboarding, Hold, or Financial Pause → Client Meeting (Check-In)",
            "No account, but the Subject names an active client by their Salesforce account name (e.g. \"Precision Stamping Check in\") → Client Meeting (Check-In)",
            "Otherwise → Prospect Meeting",
          ]}
          grouping="Owner"
          sorting="Activity Date"
        />
        Points per category are set on the Weights page. Salesforce sync is a rolling
        7-day window (nightly); once synced, historical data is kept. Hovering a row
        shows the underlying source records on the left and the points calculation on
        the right, for the selected period.
        <br /><br />
        Managers (from Salesforce Manager, or Manager (Text) as a fallback when Manager
        isn&apos;t set) show a &quot;Manager avg&quot; row instead of their own personal
        activity: the average Hustle Points across their active direct reports for the
        selected period. Reports who are themselves managers aren&apos;t counted in a
        higher-level manager&apos;s average, so nothing rolls up more than one level.
        Hovering a manager row shows their team and each person&apos;s own total.
        <br /><br />
        The &quot;Company Average&quot; divider splits the list at the mean total
        (including manager-average rows) across everyone shown for the selected period.
      </FilterNote>
    </div>
  );
}
