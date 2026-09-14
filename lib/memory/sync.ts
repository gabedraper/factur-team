import { createServiceClient } from "@/lib/supabase/server";
import { syncDriveFor } from "./drive";
import { syncChatFor } from "./chat";

/*
 * One pass over the feeders, inside a request's time limit.
 *
 * The staff list is worked through in the order of who was read longest ago,
 * a few people per run, so the first full pull spreads over hours and after
 * that everyone is refreshed every few hours. Each account is given a slice
 * of the run; whatever it does not finish, it picks up next time from its
 * own cursor.
 */

const SOURCES = ["drive", "chat"] as const;
type Source = (typeof SOURCES)[number];

const PER_ACCOUNT_MS = 45_000;

export type SyncReport = {
  ran: { source: Source; account: string; result: unknown }[];
  seconds: number;
};

async function staff(): Promise<string[]> {
  const { data } = await createServiceClient()
    .from("org_members").select("email").eq("active", true).not("email", "is", null);
  return ((data ?? []) as { email: string }[]).map((m) => m.email.toLowerCase());
}

/** Accounts ordered by how stale each source is for them. */
async function queue(): Promise<{ source: Source; account: string }[]> {
  const people = await staff();
  const { data } = await createServiceClient().from("memory_sync").select("source,account,last_run_at");
  const seen = new Map(
    ((data ?? []) as { source: string; account: string; last_run_at: string | null }[])
      .map((r) => [`${r.source}:${r.account}`, r.last_run_at ?? ""])
  );
  const all: { source: Source; account: string; at: string }[] = [];
  for (const source of SOURCES) {
    for (const account of people) all.push({ source, account, at: seen.get(`${source}:${account}`) ?? "" });
  }
  return all.sort((a, b) => a.at.localeCompare(b.at));
}

export async function runSync(budgetMs: number): Promise<SyncReport> {
  const started = Date.now();
  const end = started + budgetMs;
  const report: SyncReport = { ran: [], seconds: 0 };

  for (const job of await queue()) {
    if (Date.now() + 10_000 > end) break;
    const deadline = Math.min(Date.now() + PER_ACCOUNT_MS, end - 5_000);
    try {
      const result = job.source === "drive"
        ? await syncDriveFor(job.account, deadline)
        : await syncChatFor(job.account, deadline);
      report.ran.push({ source: job.source, account: job.account, result });
    } catch (e) {
      report.ran.push({ source: job.source, account: job.account, result: { error: e instanceof Error ? e.message : "failed" } });
    }
  }

  report.seconds = Math.round((Date.now() - started) / 1000);
  return report;
}
