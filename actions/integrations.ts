"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import { INTEGRATIONS, catalogued, type Integration } from "@/lib/integrations/catalogue";
import { SCOPES } from "@/lib/google/auth";
import { BILLING_QUERY } from "@/lib/google/gmail";

/**
 * The state of every connection, read from the running system.
 *
 * Nothing here is a description of what the app does. The schedules come from
 * the scheduler, the row counts from the tables, the failures from the log of
 * the last run, the Gmail search and the Google scopes from the same constants
 * the code runs on. A page built this way cannot tell you the sync runs hourly
 * after somebody changes it to run daily.
 */

export type TableState = {
  name: string;
  rows: number | null;
  size: string | null;
  /** Best available signal of when this last changed. See the note below. */
  lastChanged: string | null;
  missing: boolean;
};

export type Schedule = {
  name: string;
  cron: string;
  active: boolean;
  runs: string;
};

export type IngestRun = {
  kind: string;
  account: string;
  ranAt: string;
  found: number;
  attached: number;
  hitCap: boolean;
  problem: string | null;
};

export type IntegrationState = Integration & {
  tableState: TableState[];
};

export type IntegrationsReport = {
  integrations: IntegrationState[];
  schedules: Schedule[];
  recentRuns: IngestRun[];
  failing: IngestRun[];
  /** Staging tables the database has that the catalogue does not describe. */
  undocumented: string[];
  googleScopes: { service: string; scopes: string[] }[];
  billingQuery: string;
  uptime: { ok: boolean; checkedAt: string; url: string; error: string | null } | null;
  problem: string | null;
};

/*
 * Cron is written for machines. These are the schedules the app actually uses,
 * spelled out; anything else falls back to showing the expression itself
 * rather than guessing at it.
 */
function inEnglish(cron: string): string {
  const known: Record<string, string> = {
    "*/5 * * * *": "Every 5 minutes",
    "*/10 * * * *": "Every 10 minutes",
    "5 * * * *": "Hourly, 5 past",
    "30 13 * * *": "Daily, 13:30 UTC",
    "15 14-23 * * 1-5": "Hourly, weekdays 14:00–23:00 UTC",
  };
  return known[cron] ?? cron;
}

export async function integrationsReport(): Promise<IntegrationsReport> {
  // Readable by anyone signed in. The point of the page is that the people
  // relying on this data can see where it comes from.
  const user = await getAuthedUser();
  if (!user) {
    return {
      integrations: [], schedules: [], recentRuns: [], failing: [],
      undocumented: [], googleScopes: [], billingQuery: BILLING_QUERY,
      uptime: null, problem: "Not signed in.",
    };
  }

  const db = createServiceClient();

  const [tables, schedules, runs, uptime] = await Promise.all([
    db.rpc("integration_table_state"),
    db.rpc("integration_schedules"),
    db.from("ingest_runs").select("*").order("ran_at", { ascending: false }).limit(60),
    db.from("uptime_checks").select("*").order("checked_at", { ascending: false }).limit(1),
  ]);

  type TableRow = { name: string; rows: number; size: string; last_changed: string | null };
  const byName = new Map(
    ((tables.data ?? []) as TableRow[]).map((t) => [t.name, t])
  );

  const integrations: IntegrationState[] = INTEGRATIONS.map((i) => ({
    ...i,
    tableState: i.tables.map((name) => {
      const found = byName.get(name);
      return {
        name,
        rows: found?.rows ?? null,
        size: found?.size ?? null,
        lastChanged: found?.last_changed ?? null,
        missing: !found,
      };
    }),
  }));

  /*
   * Anything staging-shaped the catalogue has not claimed.
   *
   * This is the part that keeps the page honest as the app grows: a table
   * added next month appears here as undocumented instead of quietly not
   * appearing at all.
   */
  const known = catalogued();
  const undocumented = [...byName.keys()]
    .filter((n) => /_raw$/.test(n) || n.startsWith("comm_"))
    .filter((n) => !known.has(n))
    .sort();

  const allRuns = ((runs.data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: String(r.kind),
    account: String(r.account),
    ranAt: String(r.ran_at),
    found: Number(r.found ?? 0),
    attached: Number(r.attached ?? 0),
    hitCap: Boolean(r.hit_cap),
    problem: (r.problem as string | null) ?? null,
  }));

  const check = ((uptime.data ?? []) as Record<string, unknown>[])[0];

  return {
    integrations,
    schedules: ((schedules.data ?? []) as
      { jobname: string; schedule: string; active: boolean }[]).map((s) => ({
      name: s.jobname,
      cron: s.schedule,
      active: s.active,
      runs: inEnglish(s.schedule),
    })),
    recentRuns: allRuns.slice(0, 20),
    failing: allRuns.filter((r) => r.problem),
    undocumented,
    googleScopes: Object.entries(SCOPES).map(([service, scopes]) => ({
      service,
      scopes: [...scopes],
    })),
    billingQuery: BILLING_QUERY,
    uptime: check
      ? {
          ok: Boolean(check.ok),
          checkedAt: String(check.checked_at),
          url: String(check.url),
          error: (check.error as string | null) ?? null,
        }
      : null,
    problem: null,
  };
}
