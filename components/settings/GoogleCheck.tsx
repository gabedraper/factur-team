"use client";

import { useEffect, useState, useTransition } from "react";
import {
  checkGoogleAccess, listIngestAccounts, recentIngestRuns, runIngest,
  type AccountCheck,
} from "@/actions/google-check";
import type { IngestReport } from "@/lib/ingest/comms";

const LANES: { kind: IngestReport["kind"]; label: string; doing: string }[] = [
  { kind: "mail", label: "Pull billing mail (90 days)", doing: "Reading mailbox" },
  { kind: "chat", label: "Pull chat (90 days)", doing: "Reading chat for" },
  { kind: "meetings", label: "Pull meetings (90 days)", doing: "Reading Drive for" },
];

export function GoogleCheck() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkGoogleAccess>> | null>(null);
  const [reports, setReports] = useState<(IngestReport & { ranAt?: string })[]>([]);
  const [lane, setLane] = useState<IngestReport["kind"]>("mail");

  // What the last sweep managed, so leaving the page loses nothing.
  useEffect(() => {
    recentIngestRuns().then((runs) => {
      if (runs.length === 0) return;
      const newest = runs.reduce((a, b) => (a.ranAt > b.ranAt ? a : b));
      setLane(newest.kind);
      setReports(runs.filter((r) => r.kind === newest.kind));
    });
  }, []);
  const [progress, setProgress] = useState<
    { kind: IngestReport["kind"]; done: number; total: number } | null
  >(null);
  const [ingestProblem, setIngestProblem] = useState<string | null>(null);

  function run() {
    startTransition(async () => setResult(await checkGoogleAccess()));
  }

  /*
   * One mailbox at a time, from the browser.
   *
   * All twenty-two in a single request took five minutes and was killed by the
   * function timeout, which the browser shows as the page failing to load. This
   * way each call is small, the count moves while it works, and one bad mailbox
   * does not lose the rest.
   */
  /*
   * One account at a time, from the browser.
   *
   * All twenty-three in a single request took five minutes and was killed by
   * the function timeout, which the browser shows as the page failing to load.
   * This way each call is small, the count moves while it works, and one bad
   * account does not lose the rest.
   *
   * Accounts read in the last six hours are passed over, so a sweep cut short
   * by closing the tab carries on from where it stopped rather than starting
   * again. Once they are all recent, pressing the button reads them all again.
   */
  async function pull(kind: IngestReport["kind"]) {
    setIngestProblem(null);
    setLane(kind);

    const [accounts, runs] = await Promise.all([listIngestAccounts(), recentIngestRuns()]);
    if (accounts.length === 0) {
      setIngestProblem("No accounts to read.");
      return;
    }

    const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
    const done = new Map(
      runs.filter((r) => r.kind === kind && r.ranAt > cutoff).map((r) => [r.account, r])
    );

    const todo = accounts.filter((a) => !done.has(a));
    const sweep = todo.length ? todo : accounts;

    setReports(todo.length ? [...done.values()] : []);
    setProgress({ kind, done: 0, total: sweep.length });
    for (const [i, account] of sweep.entries()) {
      const report = await runIngest(kind, account, 90);
      setReports((prev) => [...prev.filter((r) => r.account !== account), report]);
      setProgress({ kind, done: i + 1, total: sweep.length });
    }
    setProgress(null);
    setReports(await recentIngestRuns().then((r) => r.filter((x) => x.kind === kind)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={run}
          disabled={pending || progress !== null}
          className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          {pending ? "Working…" : "Check connection"}
        </button>
        {LANES.map((lane) => (
          <button
            key={lane.kind}
            onClick={() => pull(lane.kind)}
            disabled={pending || progress !== null}
            className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
          >
            {progress?.kind === lane.kind
              ? `${lane.doing} ${progress.done + 1} of ${progress.total}…`
              : lane.label}
          </button>
        ))}
      </div>

      {result?.problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {result.problem}
        </p>
      )}

      {ingestProblem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {ingestProblem}
        </p>
      )}

      {reports.some((r) => r.kind === lane) && (
        <div className="space-y-2">
          <p className="text-sm">
            {(() => {
              const shown = reports.filter((r) => r.kind === lane);
              const sum = (f: (r: IngestReport) => number) =>
                shown.reduce((n, r) => n + f(r), 0);
              return `${sum((r) => r.attached)} attached to a client, out of ${sum(
                (r) => r.found
              )} read — ${sum((r) => r.matching)} matched the search`;
            })()}
          </p>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium text-right">Matching</th>
                  <th className="px-3 py-2 font-medium text-right">Read</th>
                  <th className="px-3 py-2 font-medium text-right">Attached</th>
                  <th className="px-3 py-2 font-medium text-right">By domain</th>
                  <th className="px-3 py-2 font-medium text-right">By thread</th>
                  <th className="px-3 py-2 font-medium text-right">By name</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {[...reports]
                  .filter((r) => r.kind === lane)
                  .sort((a, b) => a.account.localeCompare(b.account))
                  .map((r) => (
                  <tr key={`${r.kind}-${r.account}`} className="border-b last:border-0">
                    <td className="px-3 py-2">{r.account}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.matching}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.found}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.attached}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.byDomain}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.byThread}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.byName}</td>
                    <td className="max-w-xs px-3 py-2 text-xs text-muted-foreground">
                      {r.problem
                        ? <span className="text-red-600 dark:text-red-400">{r.problem}</span>
                        : r.hitCap
                          ? `only the newest ${r.found} of ${r.matching} were read`
                          : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && !result.problem && (
        <>
          <p className="text-sm">
            <span className="text-muted-foreground">Service account: </span>
            <span className="font-mono text-xs">{result.serviceAccount}</span>
          </p>
          <p className="text-sm">
            {([
              ["Mail", (a: AccountCheck) => a.scopes.mail],
              ["Chat", (a: AccountCheck) => a.scopes.chat],
              ["Drive", (a: AccountCheck) => a.scopes.drive],
              ["Directory", (a: AccountCheck) => a.scopes.directory],
            ] as const).map(([label, ok], i) => {
              const n = result.accounts.filter(ok).length;
              return (
                <span key={label}>
                  {i > 0 && <span className="text-muted-foreground"> · </span>}
                  <span className={n === 0 ? "text-red-600 dark:text-red-400" : ""}>
                    {label} {n} of {result.accounts.length}
                  </span>
                </span>
              );
            })}
          </p>

          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Why they&apos;re read</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {result.accounts.map((a: AccountCheck) => (
                  <tr key={a.email} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{a.name ?? a.email}</div>
                      <div className="text-xs text-muted-foreground">{a.email}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {a.why}
                      {a.why.includes("by hand") && (
                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          not from a role
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {a.ok ? (
                        <span className="text-emerald-600 dark:text-emerald-400">reachable</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">{a.problem}</span>
                      )}
                      <div className="mt-0.5 flex gap-2 text-xs">
                        {([
                          ["Mail", a.scopes.mail],
                          ["Chat", a.scopes.chat],
                          ["Drive", a.scopes.drive],
                          ["Directory", a.scopes.directory],
                        ] as const).map(([label, granted]) => (
                          <span
                            key={label}
                            className={
                              granted
                                ? "text-muted-foreground"
                                : "text-red-600 line-through dark:text-red-400"
                            }
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
