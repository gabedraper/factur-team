import type { ScoreboardPageProps } from "@/lib/scoreboard/page-props";
import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  RETENTION_PERIODS,
  RETENTION_PERIOD_LABEL,
  retentionPeriodRange,
  isRetentionPeriod,
} from "@/lib/scoreboard/deal-period";
import { FilterNote } from "@/components/scoreboard/FilterNote";
import { ReportSpec } from "@/components/scoreboard/ReportSpec";
import { SourceRecordsBlurb } from "@/components/scoreboard/SourceRecordsBlurb";
import { TeamBlurb } from "@/components/scoreboard/TeamBlurb";
import { MaskedName } from "@/components/scoreboard/MaskedName";
import { MaskedBlurb } from "@/components/scoreboard/MaskedBlurb";
import { BOARD_MASKING } from "@/lib/scoreboard/verification-mode";
import { getViewerRepId } from "@/lib/scoreboard/viewer";
import { companyAverageSplit } from "@/lib/scoreboard/leaderboard-average";
import { Avatar } from "@/components/ui/thumbnail";
import { repAvatars } from "@/lib/org";

const MIN_OPPORTUNITIES_TO_RANK = 5;
const RETENTION_DEAL_TYPES = ["Renewed Client", "Lost Client", "Early Terminated Client"] as const;

type SourceRecord = { date: string; label: string; description: string; link: string };

type RepStats = {
  rep_id: string;
  display_name: string;
  renewed: number;
  lost: number;
  earlyTerminated: number;
  total: number;
  renewalPct: number | null;
  records: SourceRecord[];
  isManager?: boolean;
  team?: { display_name: string; renewalPct: number | null; total: number }[];
};

function StatsRow({
  rep,
  maskRow,
  avatars,
}: {
  rep: RepStats;
  maskRow: boolean;
  avatars: Record<string, string>;
}) {
  return (
    <div className="group relative flex items-center gap-4 py-3">
      {/* Never on a masked row -- a face names somebody as well as their
          name does. */}
      {!maskRow && (
        <Avatar name={rep.display_name} src={avatars[rep.rep_id]} size={28} />
      )}
      <span className="flex-1 text-sm">
        {maskRow ? (
          <MaskedName />
        ) : (
          <>
            {rep.display_name}
            {rep.isManager && (
              <span className="ml-2 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                Team aggregate
              </span>
            )}
          </>
        )}
      </span>
      <span className="w-16 text-right text-sm text-slate-400">{rep.renewed}</span>
      <span className="w-12 text-right text-sm text-slate-400">{rep.lost + rep.earlyTerminated}</span>
      <span className="w-16 text-right text-sm text-slate-400">{rep.earlyTerminated}</span>
      <span className="w-14 text-right text-sm text-slate-400">{rep.total}</span>
      <span className="w-16 text-right text-sm font-medium">
        {rep.renewalPct === null ? "—" : `${rep.renewalPct.toFixed(0)}%`}
      </span>
      {maskRow ? (
        <MaskedBlurb side="left" />
      ) : rep.isManager ? (
        <TeamBlurb
          repName={rep.display_name}
          team={[...(rep.team ?? [])]
            .sort((a, b) => (b.renewalPct ?? -1) - (a.renewalPct ?? -1))
            .map((t) => ({
              display_name: t.display_name,
              detail: t.renewalPct === null ? `— (${t.total})` : `${t.renewalPct.toFixed(0)}% (${t.total})`,
            }))}
        />
      ) : (
        <SourceRecordsBlurb repName={rep.display_name} records={rep.records} />
      )}
    </div>
  );
}

export default async function RetentionPage(props: ScoreboardPageProps) {
  const sp = await props.searchParams;
  const period = isRetentionPeriod(sp.period) ? sp.period : "all_time";
  const { start, end } = retentionPeriodRange(period);

  const supabase = await createClient();
  const viewerRepId = await getViewerRepId(supabase);
  const [{ data, error }, { data: detail }, { data: repsRows }, avatars] = await Promise.all([
    supabase
      .from("retention_stats")
      .select("rep_id, display_name, deal_type")
      .gte("event_date", start)
      .lte("event_date", end),
    supabase
      .from("deal_activity_detail")
      .select("rep_id, event_date, deal_type, account_name, sf_link")
      .in("deal_type", RETENTION_DEAL_TYPES)
      .gte("event_date", start)
      .lte("event_date", end)
      .order("event_date", { ascending: false }),
    supabase
      .from("reps")
      .select("id, display_name, salesforce_owner_id, manager_salesforce_id, manager_rep_id")
      .eq("active", true),
    repAvatars(),
  ]);

  const stats = new Map<string, Omit<RepStats, "total" | "renewalPct">>();
  for (const row of data ?? []) {
    const existing = stats.get(row.rep_id) ?? {
      rep_id: row.rep_id,
      display_name: row.display_name,
      renewed: 0,
      lost: 0,
      earlyTerminated: 0,
      records: [],
    };
    if (row.deal_type === "Renewed Client") existing.renewed += 1;
    else if (row.deal_type === "Lost Client") existing.lost += 1;
    else if (row.deal_type === "Early Terminated Client") existing.earlyTerminated += 1;
    stats.set(row.rep_id, existing);
  }
  for (const row of detail ?? []) {
    const rep = stats.get(row.rep_id);
    if (rep) {
      rep.records.push({
        date: row.event_date,
        label: row.deal_type,
        description: row.account_name ?? "(no account)",
        link: row.sf_link,
      });
    }
  }

  const withTotals: RepStats[] = Array.from(stats.values()).map((rep) => {
    const decided = rep.renewed + rep.lost + rep.earlyTerminated;
    return {
      ...rep,
      total: rep.renewed + rep.lost + rep.earlyTerminated,
      renewalPct: decided > 0 ? (rep.renewed / decided) * 100 : null,
    };
  });

  const statsByRepId = new Map(withTotals.map((r) => [r.rep_id, r]));
  const repsBySfId = new Map((repsRows ?? []).map((r) => [r.salesforce_owner_id, r]));
  const effectiveManagerId = new Map<string, string>();
  for (const r of repsRows ?? []) {
    const managerId = r.manager_rep_id ?? repsBySfId.get(r.manager_salesforce_id ?? "")?.id;
    if (managerId) effectiveManagerId.set(r.id, managerId);
  }
  const managerRepIds = new Set(effectiveManagerId.values());
  const viewerIsManager = viewerRepId ? managerRepIds.has(viewerRepId) : false;
  const masking = BOARD_MASKING.retention && !viewerIsManager;

  const teamByManagerId = new Map<string, { id: string; display_name: string }[]>();
  for (const r of repsRows ?? []) {
    if (managerRepIds.has(r.id)) continue;
    const managerId = effectiveManagerId.get(r.id);
    if (!managerId) continue;
    const team = teamByManagerId.get(managerId) ?? [];
    team.push({ id: r.id, display_name: r.display_name });
    teamByManagerId.set(managerId, team);
  }

  const managerRows: RepStats[] = [];
  for (const [managerId, team] of teamByManagerId) {
    const manager = (repsRows ?? []).find((r) => r.id === managerId);
    if (!manager || team.length === 0) continue;
    const teamStats = team.map((t) => statsByRepId.get(t.id));
    const renewed = teamStats.reduce((s, r) => s + (r?.renewed ?? 0), 0);
    const lost = teamStats.reduce((s, r) => s + (r?.lost ?? 0), 0);
    const earlyTerminated = teamStats.reduce((s, r) => s + (r?.earlyTerminated ?? 0), 0);
    const decided = renewed + lost + earlyTerminated;
    managerRows.push({
      rep_id: `${managerId}-manager`,
      display_name: manager.display_name,
      renewed,
      lost,
      earlyTerminated,
      total: decided,
      renewalPct: decided > 0 ? (renewed / decided) * 100 : null,
      records: [],
      isManager: true,
      team: team.map((t) => {
        const s = statsByRepId.get(t.id);
        return { display_name: t.display_name, renewalPct: s?.renewalPct ?? null, total: s?.total ?? 0 };
      }),
    });
  }

  const allStats = [
    ...withTotals.filter((r) => !teamByManagerId.has(r.rep_id)),
    ...managerRows,
  ];

  const byRenewalPct = (a: RepStats, b: RepStats) => {
    if (a.renewalPct === null) return 1;
    if (b.renewalPct === null) return -1;
    return b.renewalPct - a.renewalPct;
  };

  // A failed query means the numbers are unknown, not zero. Without this the
  // rows still render at zero, which reads as a real result rather than a
  // failure to load one.
  const shown = error ? [] : allStats;
  const ranked = shown
    .filter((r) => r.total >= MIN_OPPORTUNITIES_TO_RANK)
    .sort(byRenewalPct);
  const unranked = shown
    .filter((r) => r.total < MIN_OPPORTUNITIES_TO_RANK)
    .sort((a, b) => b.total - a.total);
  const avgSplit = companyAverageSplit(ranked, (rep) => rep.renewalPct ?? 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Retention</h1>
          <p className="text-sm text-slate-500">Renewed, lost, and early-terminated clients per person</p>
        </div>
        <div className="flex gap-2">
          {RETENTION_PERIODS.map((p) => (
            <Link
              key={p}
              href={`/scoreboard/retention?period=${p}`}
              className={`flex items-center justify-center rounded-md px-3 py-1.5 text-center text-sm ${
                period === p
                  ? "bg-white text-slate-900"
                  : "bg-slate-900 text-slate-400 hover:text-slate-100"
              }`}
            >
              {RETENTION_PERIOD_LABEL[p]}
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400">
          Couldn&apos;t load retention data: {error.message}
        </p>
      )}

      <div className="divide-y divide-slate-900">
        <div className="flex items-center gap-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <span className="flex-1">Rep</span>
          <span className="w-16 text-right">Renewed</span>
          <span className="w-12 text-right">Lost</span>
          <span className="w-16 text-right">Early Term</span>
          <span className="w-14 text-right">Total</span>
          <span className="w-16 text-right">Renewal %</span>
        </div>
        {ranked.map((rep, i) => (
          <Fragment key={rep.rep_id}>
            {avgSplit && i === avgSplit.insertAt && (
              <div className="flex items-center gap-3 py-2">
                <span className="h-px flex-1 bg-slate-800" />
                <span className="shrink-0 text-xs font-medium text-slate-500">
                  Company Average — {Math.round(avgSplit.average)}%
                </span>
                <span className="h-px flex-1 bg-slate-800" />
              </div>
            )}
            <StatsRow rep={rep} maskRow={masking && rep.rep_id !== viewerRepId} avatars={avatars} />
          </Fragment>
        ))}
        {avgSplit && avgSplit.insertAt === ranked.length && (
          <div className="flex items-center gap-3 py-2">
            <span className="h-px flex-1 bg-slate-800" />
            <span className="shrink-0 text-xs font-medium text-slate-500">
              Company Average — {Math.round(avgSplit.average)}%
            </span>
            <span className="h-px flex-1 bg-slate-800" />
          </div>
        )}
        {ranked.length === 0 && !error && (
          <p className="py-6 text-center text-sm text-slate-500">
            No one has {MIN_OPPORTUNITIES_TO_RANK} or more renewal opportunities in this period yet.
          </p>
        )}

        {unranked.length > 0 && (
          <>
            <div className="border-t-2 border-slate-700 py-3 text-center text-xs text-slate-500">
              Retention Ranking begins after {MIN_OPPORTUNITIES_TO_RANK} opportunities
            </div>
            {unranked.map((rep) => (
              <StatsRow key={rep.rep_id} rep={rep} maskRow={masking && rep.rep_id !== viewerRepId} avatars={avatars} />
            ))}
          </>
        )}
      </div>

      <FilterNote>
        <ReportSpec
          reportType="Opportunities"
          filters={[
            "Client = \"Factur Contract Renewals\"",
            "Renewal Outcome = Renewed, Churned at Renewal, or Early Termination",
            "Renewal Outcome Date ≥ 1/1/2025",
            "(Pending / Transferred / Excluded outcomes aren't counted)",
          ]}
          grouping={
            "Renewal Credit Owner (falls back to a text match on \"Renewal Credit Owner (text)\" " +
            "when that lookup is blank) — AND separately, the original salesperson: the Owner of " +
            "the earliest related Opportunity for the same Account where Client = \"Factur " +
            "Outsourced Prospecting\" and Prospecting Lead Status = \"Customer\". Both teams get " +
            "credited, so each renewal can show up under two reps."
          }
          sorting={
            "Renewal % descending, nulls last. Renewal % = Renewed ÷ (Renewed + Lost + Early " +
            "Terminated) — Early Terminated counts as a Lost renewal for both the Lost column " +
            `and the rate. Reps with fewer than ${MIN_OPPORTUNITIES_TO_RANK} total opportunities ` +
            "are shown below the line, unranked, sorted by Total descending."
          }
        />
        Hovering a row shows the underlying Opportunity records for the selected period.
        <br /><br />
        Managers (from Salesforce Manager, or Manager (Text) as a fallback when Manager
        isn&apos;t set) show a &quot;Team aggregate&quot; row instead of their own
        personal outcomes: their active direct reports&apos; Renewed/Lost/Early
        Terminated counts summed together, with Renewal % recomputed from that pooled
        total. Reports who are themselves managers aren&apos;t counted in a
        higher-level manager&apos;s aggregate. Hovering a manager row shows their team
        and each person&apos;s own renewal rate.
        <br /><br />
        The &quot;Company Average&quot; divider splits the ranked list at the mean
        Renewal % (including manager-aggregate rows) across everyone ranked for the
        selected period. Unranked reps aren&apos;t included -- too few opportunities to
        compare by rate.
      </FilterNote>
    </div>
  );
}
