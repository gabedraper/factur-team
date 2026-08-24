"use client";

import { useState, useTransition } from "react";
import {
  checkGoogleAccess, runBillingIngest,
  type AccountCheck,
} from "@/actions/google-check";

export function GoogleCheck() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkGoogleAccess>> | null>(null);
  const [ingest, setIngest] = useState<Awaited<ReturnType<typeof runBillingIngest>> | null>(null);

  function run() {
    startTransition(async () => setResult(await checkGoogleAccess()));
  }

  function pull() {
    startTransition(async () => setIngest(await runBillingIngest(90)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={run}
          disabled={pending}
          className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          {pending ? "Working…" : "Check connection"}
        </button>
        <button
          onClick={pull}
          disabled={pending}
          className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          {pending ? "Working…" : "Pull billing mail (90 days)"}
        </button>
      </div>

      {result?.problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {result.problem}
        </p>
      )}

      {ingest?.problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {ingest.problem}
        </p>
      )}

      {ingest && !ingest.problem && (
        <div className="space-y-2">
          <p className="text-sm">
            {ingest.reports.reduce((n, r) => n + r.attached, 0)} messages attached to a client,
            out of {ingest.reports.reduce((n, r) => n + r.found, 0)} found
          </p>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Mailbox</th>
                  <th className="px-3 py-2 font-medium text-right">Found</th>
                  <th className="px-3 py-2 font-medium text-right">Attached</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {ingest.reports.map((r) => (
                  <tr key={r.account} className="border-b last:border-0">
                    <td className="px-3 py-2">{r.account}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.found}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.attached}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.problem
                        ? <span className="text-red-600 dark:text-red-400">{r.problem}</span>
                        : r.hitCap
                          ? "more than the 150 cap — older ones not pulled"
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
            {result.accounts.filter((a) => a.ok).length} of {result.accounts.length} accounts
            reachable
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
                    <td className="px-3 py-2 text-muted-foreground">{a.why}</td>
                    <td className="px-3 py-2">
                      {a.ok ? (
                        <span className="text-emerald-600 dark:text-emerald-400">reachable</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">{a.problem}</span>
                      )}
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
