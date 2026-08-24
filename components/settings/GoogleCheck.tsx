"use client";

import { useState, useTransition } from "react";
import { checkGoogleAccess, type AccountCheck } from "@/actions/google-check";

export function GoogleCheck() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkGoogleAccess>> | null>(null);

  function run() {
    startTransition(async () => setResult(await checkGoogleAccess()));
  }

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={pending}
        className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
      >
        {pending ? "Checking…" : "Check connection"}
      </button>

      {result?.problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {result.problem}
        </p>
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
