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

/*
 * What each column means, on hover.
 *
 * Timing columns invite the wrong reading -- an average hides the bad visits,
 * and a percentile over ten views is one bad visit. Both traps are named here
 * rather than left for someone to fall into.
 */
const HINTS = {
  page: "The route, as the app knows it. A highlighted row is a path with views that the route list has never heard of \u2014 usually a page that was renamed or removed.",
  views: "Times the page was opened in the period.",
  people: "Distinct people who opened it. Two views by one person is a different problem from two views by two people.",
  move: "Average time to move here from another page inside the app \u2014 a server round trip and nothing else.",
  arrive: "Average time to arrive fresh: the document, the scripts and the first render as well as the server.\n\nAlways slower than Move. If it is far slower, the cost is in loading the page rather than in fetching its data.",
  median: "The middle visit: half were faster, half slower.\n\nThis is what the page normally costs. Read it next to p95 \u2014 close together means uniformly slow, far apart means occasionally slow.",
  p95: "95 out of 100 visits were faster than this; the slowest 5 were worse.\n\nNeeds roughly 20 views to mean anything. Below that it is close to the single slowest visit, so a page opened ten times with one cold start will show an alarming number that is not a trend.",
  slow: "Visits that took three seconds or more \u2014 the count, not a percentage.\n\nThe table is sorted on this, because twenty-four people waiting is a bigger problem than one person waiting longer.",
  last: "The most recent view.",
};

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
                <th className="px-3 py-2 font-medium"><span title={HINTS.page}>Page</span></th>
                <th className="px-3 py-2 text-right font-medium"><span title={HINTS.views}>Views</span></th>
                <th className="px-3 py-2 text-right font-medium"><span title={HINTS.people}>People</span></th>
                <th className="px-3 py-2 text-right font-medium"><span title={HINTS.move}>Move</span></th>
                <th className="px-3 py-2 text-right font-medium"><span title={HINTS.arrive}>Arrive</span></th>
                <th className="px-3 py-2 text-right font-medium"><span title={HINTS.median}>Median</span></th>
                <th className="px-3 py-2 text-right font-medium"><span title={HINTS.p95}>p95</span></th>
                <th className="px-3 py-2 text-right font-medium"><span title={HINTS.slow}>Slow</span></th>
                <th className="px-3 py-2 font-medium"><span title={HINTS.last}>Last</span></th>
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
                  <td className={`px-3 py-1.5 text-right tabular-nums ${tone(p.medianMs)}`}>
                    {ms(p.medianMs)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${tone(p.p95Ms)} ${
                      p.views < 20 ? "opacity-50" : ""
                    }`}
                    title={p.views < 20 ? `Only ${p.views} views \u2014 close to the slowest single visit` : undefined}
                  >
                    {ms(p.p95Ms)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.slowViews || "—"}
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
