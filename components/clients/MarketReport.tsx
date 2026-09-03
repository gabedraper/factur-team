import { Chip, Panel } from "@/components/pipeline/bits";
import type { MarketReport, MarketRow, Trend, CoverageStatus } from "@/lib/market/report";

const nf = new Intl.NumberFormat("en-US");
const pf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short", year: "numeric", timeZone: "UTC",
});

/*
 * One hue throughout. Every bar on this page is the same measure -- companies --
 * cut at a different point, so a second colour would imply a second thing being
 * measured. Length carries the magnitude; colour carries nothing, on purpose.
 */
const BAR = "fill-sky-600 dark:fill-sky-500";

const STATUS: Record<CoverageStatus, { label: string; colour: "emerald" | "amber" | "slate" }> = {
  ok: { label: "Measured", colour: "emerald" },
  implausible: { label: "Exceeds census", colour: "amber" },
  low_precision: { label: "Labels too broad", colour: "amber" },
  no_records: { label: "No records", colour: "slate" },
};

const METRIC_LABEL: Record<Trend["metric"], string> = {
  new_orders: "New orders",
  backlog: "Backlog",
  industrial_production: "Production",
};

// --- Pieces ------------------------------------------------------------------

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

/*
 * The funnel. Bars are drawn against the widest stage, and a stage that rounds
 * to nothing still gets two pixels -- when a client has been shown four
 * companies out of thirty-six thousand, the sliver IS the finding, and a bar
 * that disappears entirely reads as missing data instead.
 */
function Funnel({ stages }: { stages: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  const rowH = 44;
  const barH = 18;
  const labelW = 132;
  const width = 760;

  return (
    <svg
      viewBox={`0 0 ${width} ${stages.length * rowH}`}
      className="w-full"
      role="img"
      aria-label="Companies at each stage"
    >
      {stages.map((s, i) => {
        const y = i * rowH;
        const full = width - labelW - 140;
        const w = Math.max((s.value / max) * full, 2);
        return (
          <g key={s.label}>
            <title>{`${s.label}: ${nf.format(s.value)}`}</title>
            <text
              x={0}
              y={y + barH}
              className="fill-muted-foreground text-[11px] uppercase tracking-wide"
            >
              {s.label}
            </text>
            <rect x={labelW} y={y + 4} width={w} height={barH} rx={4} className={BAR} />
            <text
              x={labelW + w + 8}
              y={y + barH}
              className="fill-foreground text-[13px] font-medium tabular-nums"
            >
              {nf.format(s.value)}
            </text>
            {s.note && (
              <text
                x={labelW + w + 8}
                y={y + barH + 13}
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {s.note}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A coverage bar that shows the estimate and, behind it, the upper bound. */
function CoverageBar({ row }: { row: MarketRow }) {
  if (row.status !== "ok" || row.coveragePct === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const pct = Math.min(row.coveragePct, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-sky-600 dark:bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums">{pf.format(row.coveragePct)}%</span>
    </div>
  );
}

function Sparkline({ points }: { points: { period: string; value: number }[] }) {
  const w = 168;
  const h = 36;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.value - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = points[points.length - 1];
  const lastX = w;
  const lastY = h - ((last.value - min) / span) * (h - 4) - 2;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[168px]" role="img" aria-label="Five-year trend">
      <title>{`${monthLabel.format(new Date(points[0].period))} to ${monthLabel.format(new Date(last.period))}`}</title>
      <path d={d} fill="none" strokeWidth={2} className="stroke-sky-600 dark:stroke-sky-500" />
      <circle cx={lastX} cy={lastY} r={3} className="fill-sky-600 dark:fill-sky-500" />
    </svg>
  );
}

function TrendCard({ trend }: { trend: Trend }) {
  const up = (trend.changePct ?? 0) >= 0;
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{trend.market}</div>
        <div className="truncate text-xs text-muted-foreground">
          {METRIC_LABEL[trend.metric]} · {trend.title}
        </div>
      </div>
      <Sparkline points={trend.points} />
      <div className="w-16 text-right">
        <div
          className={
            "text-sm font-semibold tabular-nums " +
            (up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")
          }
        >
          {up ? "+" : ""}
          {trend.changePct === null ? "—" : `${pf.format(trend.changePct)}%`}
        </div>
        <div className="text-[11px] text-muted-foreground">year</div>
      </div>
    </div>
  );
}

// --- The page ----------------------------------------------------------------

export function MarketReportView({ report }: { report: MarketReport }) {
  const all = report.markets.find((m) => m.market === "(all)");
  const rows = report.markets
    .filter((m) => m.market !== "(all)")
    .sort((a, b) => b.tamEstablishments - a.tamEstablishments);

  // Already one line per market, largest first. Six reads at a glance.
  const trends = report.trends.slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Market"
          value={all ? nf.format(all.tamEstablishments) : "—"}
          sub={all?.tamInSizeBand ? `${nf.format(all.tamInSizeBand)} with 20+ staff` : undefined}
        />
        <Tile
          label="In our database"
          value={all?.dbAccountsAdjusted !== null && all ? nf.format(Math.round(all.dbAccountsAdjusted!)) : "—"}
          sub={all ? `${nf.format(all.dbAccounts)} upper bound` : undefined}
        />
        <Tile
          label="Coverage"
          value={all?.coveragePct !== null && all ? `${pf.format(all.coveragePct!)}%` : "—"}
          sub={all ? STATUS[all.status].label : undefined}
        />
        <Tile label="Contacted" value={all ? nf.format(all.contacted) : "—"} />
      </div>

      {all && (
        <Panel title="Funnel">
          <div className="p-4">
            <Funnel
              stages={[
                { label: "Market", value: all.tamEstablishments },
                { label: "20+ staff", value: all.tamInSizeBand ?? 0 },
                {
                  label: "In our database",
                  value: Math.round(all.dbAccountsAdjusted ?? 0),
                  note: `${nf.format(all.dbAccounts)} upper bound`,
                },
                { label: "Contacted", value: all.contacted },
              ]}
            />
          </div>
        </Panel>
      )}

      <Panel title="Markets">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Market</th>
              <th className="px-4 py-2 font-medium">NAICS</th>
              <th className="px-4 py-2 text-right font-medium">Companies</th>
              <th className="px-4 py-2 text-right font-medium">20+ staff</th>
              <th className="px-4 py-2 text-right font-medium">Ours</th>
              <th className="px-4 py-2 font-medium">Coverage</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Contacted</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.market} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">{r.market}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {r.naics.map((n) => n.code).join(", ")}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {nf.format(r.tamEstablishments)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {r.tamInSizeBand === null ? "—" : nf.format(r.tamInSizeBand)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {r.dbAccountsAdjusted === null ? "—" : nf.format(Math.round(r.dbAccountsAdjusted))}
                </td>
                <td className="px-4 py-2.5">
                  <CoverageBar row={r} />
                </td>
                <td className="px-4 py-2.5">
                  <Chip colour={STATUS[r.status].colour}>{STATUS[r.status].label}</Chip>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(r.contacted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {trends.length > 0 && (
        <Panel title="Sector trend">
          <div className="grid gap-2 p-3 lg:grid-cols-2">
            {trends.map((t) => (
              <TrendCard key={t.market} trend={t} />
            ))}
          </div>
        </Panel>
      )}

      {report.unmapped.length > 0 && (
        <Panel title="Unmapped markets">
          <div className="flex flex-wrap gap-1.5 p-4">
            {report.unmapped.map((u) => (
              <Chip key={u} colour="slate">
                {u}
              </Chip>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
