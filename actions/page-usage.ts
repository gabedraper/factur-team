"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { ROUTES } from "@/lib/routes.generated";

/**
 * Every page, what it gets used for and what it costs.
 *
 * Built from the route list outward rather than from the recorded views, for
 * the same reason the staff reports are built from the staff list: a page
 * nobody has opened has no rows to find, and reading the views alone would
 * quietly answer "which pages are used" instead of "which are not".
 *
 * The counting happens in the database. It used to happen here, over every row
 * fetched with a ceiling on them, which would have started silently reporting
 * on part of the period about a month in.
 */

export type PageUsage = {
  path: string;
  views: number;
  people: number;
  /** Moves inside the app: a server round trip, nothing else. */
  routeMs: number | null;
  /** Fresh arrivals: document, scripts and first render as well. */
  loadMs: number | null;
  /** What a typical visit costs. */
  medianMs: number | null;
  /** The slow tail, which is what people actually complain about. */
  p95Ms: number | null;
  /** Visits over three seconds -- the count, not the percentile. */
  slowViews: number;
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

type Stat = {
  path: string;
  views: number;
  people: number;
  route_ms: number | null;
  load_ms: number | null;
  median_ms: number | null;
  p95_ms: number | null;
  slow_views: number | null;
  last_seen: string | null;
};

export async function pageUsage(days = 30): Promise<PageUsageReport> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return { pages: [], days, totalViews: 0, problem: "Not permitted." };
  }

  const { data, error } = await createServiceClient().rpc("page_usage_stats", {
    p_days: days,
  });

  if (error) {
    return { pages: [], days, totalViews: 0, problem: error.message };
  }

  const stats = (data ?? []) as Stat[];
  const byPath = new Map(stats.map((s) => [s.path, s]));

  const known = new Set<string>(ROUTES);
  const paths = new Set<string>([...ROUTES, ...byPath.keys()]);

  const pages: PageUsage[] = [...paths].map((path) => {
    const s = byPath.get(path);
    return {
      path,
      views: Number(s?.views ?? 0),
      people: Number(s?.people ?? 0),
      routeMs: s?.route_ms ?? null,
      loadMs: s?.load_ms ?? null,
      medianMs: s?.median_ms ?? null,
      p95Ms: s?.p95_ms ?? null,
      slowViews: Number(s?.slow_views ?? 0),
      lastSeen: s?.last_seen ?? null,
      known: known.has(path),
    };
  });

  /*
   * Worst first, where worst means the most people kept waiting.
   *
   * This used to rank on p95 alone, which put the noisiest rows on top: at ten
   * views the 95th percentile is nearly the slowest single observation, so a
   * page three people opened once -- one of them a cold start -- outranked a
   * page fifteen people wait four seconds for every day.
   *
   * slowViews is a count of visits over three seconds, so it is weighted by
   * traffic by construction. p95 breaks ties, and a page with no views has no
   * speed to rank on and goes last rather than sorting as the fastest thing in
   * the app.
   */
  pages.sort((a, b) => {
    if (!a.views !== !b.views) return a.views ? -1 : 1;
    if (a.slowViews !== b.slowViews) return b.slowViews - a.slowViews;
    return (b.p95Ms ?? 0) - (a.p95Ms ?? 0);
  });

  return {
    pages,
    days,
    totalViews: pages.reduce((n, p) => n + p.views, 0),
    problem: null,
  };
}
