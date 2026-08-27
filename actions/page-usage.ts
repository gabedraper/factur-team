"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { ROUTES } from "@/lib/routes.generated";

/**
 * Every page, what it gets used for and what it costs.
 *
 * Built from the route list outward rather than from the recorded views, for
 * the same reason the staff list drives the usage reports: a page nobody has
 * opened has no rows to find, and reading the views alone would quietly answer
 * a question nobody asked -- "which pages are used" instead of "which are not".
 */

export type PageUsage = {
  path: string;
  views: number;
  people: number;
  /** Moves inside the app: a server round trip, nothing else. */
  routeMs: number | null;
  /** Fresh arrivals: document, scripts and first render as well. */
  loadMs: number | null;
  /** The slow tail, which is what people actually complain about. */
  p95Ms: number | null;
  lastSeen: string | null;
  /** False for a path with views that the route list has never heard of. */
  known: boolean;
};

export type PageUsageReport = {
  pages: PageUsage[];
  days: number;
  totalViews: number;
  problem: string | null;
};

type Row = {
  path: string;
  kind: "load" | "route";
  duration_ms: number;
  member_id: string | null;
  occurred_at: string;
};

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[at];
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export async function pageUsage(days = 30): Promise<PageUsageReport> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return { pages: [], days, totalViews: 0, problem: "Not permitted." };
  }

  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  /*
   * Aggregated here rather than in SQL on purpose: a percentile needs every
   * duration, and pulling them is cheap while this table is small. If it
   * outgrows that, this is the thing to move into a view -- not the page.
   */
  const { data, error } = await createServiceClient()
    .from("page_views")
    .select("path, kind, duration_ms, member_id, occurred_at")
    .gte("occurred_at", since)
    .limit(100_000);

  if (error) {
    return { pages: [], days, totalViews: 0, problem: error.message };
  }

  const rows = (data ?? []) as Row[];
  const byPath = new Map<
    string,
    { route: number[]; load: number[]; people: Set<string>; last: string }
  >();

  for (const r of rows) {
    const seen = byPath.get(r.path) ?? {
      route: [], load: [], people: new Set<string>(), last: r.occurred_at,
    };
    (r.kind === "load" ? seen.load : seen.route).push(r.duration_ms);
    if (r.member_id) seen.people.add(r.member_id);
    if (r.occurred_at > seen.last) seen.last = r.occurred_at;
    byPath.set(r.path, seen);
  }

  const known = new Set<string>(ROUTES);
  const paths = new Set<string>([...ROUTES, ...byPath.keys()]);

  const pages: PageUsage[] = [...paths].map((path) => {
    const seen = byPath.get(path);
    const all = seen ? [...seen.route, ...seen.load].sort((a, b) => a - b) : [];
    return {
      path,
      views: all.length,
      people: seen?.people.size ?? 0,
      routeMs: mean(seen?.route ?? []),
      loadMs: mean(seen?.load ?? []),
      p95Ms: quantile(all, 0.95),
      lastSeen: seen?.last ?? null,
      known: known.has(path),
    };
  });

  /*
   * Slowest first, and unvisited pages last.
   *
   * This gets opened because something feels slow, so the answer belongs at the
   * top. A page with no views has no speed to rank on and would otherwise sort
   * as though it were the fastest thing in the app.
   */
  pages.sort((a, b) => {
    if (!a.views !== !b.views) return a.views ? -1 : 1;
    return (b.p95Ms ?? 0) - (a.p95Ms ?? 0);
  });

  return { pages, days, totalViews: rows.length, problem: null };
}
