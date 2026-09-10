"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { columnLabel, type Chart, type ReportResult, type ResultColumn } from "@/lib/reporting/spec";
import { formatCompact, formatValue, toNumber } from "@/lib/reporting/format";

/**
 * A saved report's chart, drawn from its result.
 *
 * The rules it follows are the data-viz ones: series take the eight
 * validated hues in fixed order and never cycle (a ninth folds into
 * "Other"); bars are thin with a rounded data end and grow from one
 * baseline; lines are 2px; a legend appears for two or more series and not
 * for one; there is exactly one axis; text never wears a series colour. The
 * colours are CSS tokens, so the chart follows the theme without knowing
 * which one it is in.
 */

const SERIES = Array.from({ length: 8 }, (_, i) => `var(--viz-${i + 1})`);
const MAX_SERIES = 8;
const OTHER = "Other";

const tooltipStyle = {
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  border: "none",
  borderRadius: 8,
  boxShadow: "var(--shadow-overlay)",
  fontSize: 12,
  padding: "6px 10px",
};

/** A bucketed date on an axis: "Sep 2026", "Q3 2026", "2026", "Sep 10". */
function tick(col: ResultColumn, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (col.kind === "date" || col.kind === "datetime") {
    const s = String(v).slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    if (!y) return s;
    const date = new Date(y, (m || 1) - 1, d || 1);
    switch (col.bucket) {
      case "year": return String(y);
      case "quarter": return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
      case "month": return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      default: return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }
  const s = formatValue(col.kind, v);
  return s.length > 24 ? `${s.slice(0, 22)}…` : s;
}

type Point = Record<string, unknown> & { __x: string; __xRaw: unknown };

/**
 * Rows into points. With a series column the rows pivot: one point per x
 * value, one key per series. Series beyond the eighth fold into "Other" --
 * a ninth hue would not be tellable from the first eight.
 */
function shape(result: ReportResult, x: ResultColumn, y: ResultColumn, series: ResultColumn | null) {
  const byX = new Map<string, Point>();
  const seriesTotals = new Map<string, number>();

  for (const row of result.rows) {
    const xv = row[x.key];
    const xk = tick(x, xv);
    const yv = toNumber(row[y.key]) ?? 0;
    const sk = series ? formatValue(series.kind, row[series.key]) : y.key;
    if (series) seriesTotals.set(sk, (seriesTotals.get(sk) ?? 0) + yv);
    const p = byX.get(xk) ?? { __x: xk, __xRaw: xv };
    p[sk] = (toNumber(p[sk]) ?? 0) + yv;
    byX.set(xk, p);
  }

  let keys = series
    ? [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    : [y.key];

  if (keys.length > MAX_SERIES) {
    const keep = keys.slice(0, MAX_SERIES - 1);
    const fold = new Set(keys.slice(MAX_SERIES - 1));
    for (const p of byX.values()) {
      let other = 0;
      for (const k of fold) {
        other += toNumber(p[k]) ?? 0;
        delete p[k];
      }
      if (other) p[OTHER] = other;
    }
    keys = [...keep, OTHER];
  }

  let points = [...byX.values()];
  // Time runs left to right, whatever order the rows arrived in.
  if (x.kind === "date" || x.kind === "datetime") {
    points = points.sort((a, b) => String(a.__xRaw).localeCompare(String(b.__xRaw)));
  }
  return { points, keys };
}

export function ReportChart({
  chart,
  result,
  height = 320,
}: {
  chart: Chart;
  result: ReportResult;
  height?: number;
}) {
  const byKey = new Map(result.columns.map((c) => [c.key, c]));
  const numeric = result.columns.filter((c) => c.kind === "number");
  const y = (chart.y && byKey.get(chart.y)) || numeric[0] || null;

  if (chart.type === "stat") {
    if (!y) return <Note>Add a measure to show a figure.</Note>;
    // One figure: the first row's measure, or the sum across groups.
    const total = result.rows.reduce((s, r) => s + (toNumber(r[y.key]) ?? 0), 0);
    const value = result.rows.length === 1 ? toNumber(result.rows[0][y.key]) : total;
    return (
      <div className="py-2">
        <div className="text-meta text-muted-foreground">{columnLabel(y)}</div>
        <div className="text-4xl font-semibold">{formatCompact(value)}</div>
      </div>
    );
  }

  const x = chart.x ? byKey.get(chart.x) : null;
  const series = chart.series ? byKey.get(chart.series) ?? null : null;
  if (!x || !y) return <Note>Pick a group for the axis and a measure to plot.</Note>;
  if (result.rows.length === 0) return <Note>Nothing to draw.</Note>;

  const { points, keys } = shape(result, x, y, series && series.key !== x.key ? series : null);
  const multi = keys.length > 1;
  const yLabel = columnLabel(y);
  const nameOf = (k: string) => (multi ? k : yLabel);
  const fmt = (v: unknown) => formatValue("number", v);

  const axisProps = {
    tick: { fill: "var(--viz-ink)", fontSize: 12 },
    axisLine: { stroke: "var(--viz-axis)" },
    tickLine: false as const,
  };

  if (chart.type === "donut") {
    /*
     * Part-to-whole at a glance, at most eight slices. The series column is
     * ignored here: a donut has one dimension.
     */
    const totals = new Map<string, number>();
    for (const row of result.rows) {
      const k = tick(x, row[x.key]);
      totals.set(k, (totals.get(k) ?? 0) + (toNumber(row[y.key]) ?? 0));
    }
    let slices = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
    if (slices.length > MAX_SERIES) {
      const other = slices.slice(MAX_SERIES - 1).reduce((s, d) => s + d.value, 0);
      slices = [...slices.slice(0, MAX_SERIES - 1), { name: OTHER, value: other }];
    }
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="hsl(var(--card))"
            strokeWidth={2}
          >
            {slices.map((_, i) => <Cell key={i} fill={SERIES[i]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "inherit" }} formatter={fmt} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const grid = <CartesianGrid vertical={false} stroke="var(--viz-grid)" />;
  const tooltip = (
    <Tooltip
      contentStyle={tooltipStyle}
      itemStyle={{ color: "inherit" }}
      labelStyle={{ color: "inherit", fontWeight: 500 }}
      cursor={{ fill: "hsl(var(--card-hover))", stroke: "var(--viz-axis)" }}
      formatter={(v, name) => [fmt(v), nameOf(String(name))]}
    />
  );
  const legend = multi ? (
    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
  ) : null;

  if (chart.type === "hbar") {
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, points.length * 28 + 40)}>
        <BarChart data={points} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" {...axisProps} tickFormatter={formatCompact} />
          <YAxis type="category" dataKey="__x" width={140} {...axisProps} />
          {tooltip}
          {legend}
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} name={nameOf(k)} fill={SERIES[i]} maxBarSize={24}
                 radius={[0, 4, 4, 0]} stackId={chart.stacked ? "a" : undefined}
                 stroke="hsl(var(--card))" strokeWidth={chart.stacked ? 1 : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === "line" || chart.type === "area") {
    const Wrap = chart.type === "line" ? LineChart : AreaChart;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Wrap data={points} margin={{ left: 8, right: 16, top: 8 }}>
          {grid}
          <XAxis dataKey="__x" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} tickFormatter={formatCompact} width={56} />
          {tooltip}
          {legend}
          {keys.map((k, i) =>
            chart.type === "line" ? (
              <Line key={k} type="monotone" dataKey={k} name={nameOf(k)} stroke={SERIES[i]}
                    strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: "hsl(var(--card))", fill: SERIES[i] }}
                    activeDot={{ r: 5 }} connectNulls />
            ) : (
              <Area key={k} type="monotone" dataKey={k} name={nameOf(k)} stroke={SERIES[i]}
                    strokeWidth={2} fill={SERIES[i]} fillOpacity={0.1}
                    stackId={chart.stacked ? "a" : undefined} connectNulls />
            ),
          )}
        </Wrap>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={points} margin={{ left: 8, right: 16, top: 8 }} barCategoryGap="20%">
        {grid}
        <XAxis dataKey="__x" {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} tickFormatter={formatCompact} width={56} />
        {tooltip}
        {legend}
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} name={nameOf(k)} fill={SERIES[i]} maxBarSize={24}
               radius={chart.stacked && i < keys.length - 1 ? 0 : [4, 4, 0, 0]}
               stackId={chart.stacked ? "a" : undefined}
               stroke="hsl(var(--card))" strokeWidth={chart.stacked ? 1 : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-meta text-muted-foreground">{children}</p>;
}
