"use client";

import { useState, useTransition } from "react";
import { pageUsage, type PageUsageReport } from "@/actions/page-usage";

function ms(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

/** Slow enough to notice, and slow enough to complain about. */
function tone(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value >= 3000) return "text-red-600 dark:text-red-400 font-medium";
  if (value >= 1000) return "text-amber-600 dark:text-amber-400";
  return "";
}

export function PageUsageTable() {
  const [report, setReport] = useState<PageUsageReport | null>(null);
  const [days, setDays] = useState(30);
  const [hideUnused, setHideUnused] = useState(false);
  const [pending, start] = useTransition();

  function load() {
    start(async () => setReport(await pageUsage(days)));
  }

  const rows = report?.pages.filter((p) => !hideUnused || p.views > 0) ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Pages</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-8 rounded-md border bg-field px-2 text-sm"
        >
          <option value={1}>24 hours</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <button
          onClick={load}
          disabled={pending}
          className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          {pending ? "Reading…" : "Read"}
        </button>
        {report && !report.problem && (
          <>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={hideUnused}
                onChange={(e) => setHideUnused(e.target.checked)}
              />
              Used only
            </label>
            <span className="text-sm text-muted-foreground">
              {report.totalViews.toLocaleString()} views · {rows.length} pages
            </span>
          </>
        )}
      </div>

      {report?.problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {report.problem}
        </p>
      )}

      {report && !report.problem && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Page</th>
                <th className="px-3 py-2 text-right font-medium">Views</th>
                <th className="px-3 py-2 text-right font-medium">People</th>
                <th className="px-3 py-2 text-right font-medium">Move</th>
                <th className="px-3 py-2 text-right font-medium">Arrive</th>
                <th className="px-3 py-2 text-right font-medium">p95</th>
                <th className="px-3 py-2 font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.path}
                  className={`border-t ${
                    p.known ? "" : "bg-amber-50/50 dark:bg-amber-950/20"
                  }`}
                >
                  <td className="px-3 py-1.5 font-mono text-xs">{p.path}</td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      p.views ? "" : "text-muted-foreground"
                    }`}
                  >
                    {p.views}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.people || "—"}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(p.routeMs)}`}>
                    {ms(p.routeMs)}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(p.loadMs)}`}>
                    {ms(p.loadMs)}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(p.p95Ms)}`}>
                    {ms(p.p95Ms)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                    {p.lastSeen ? p.lastSeen.slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
