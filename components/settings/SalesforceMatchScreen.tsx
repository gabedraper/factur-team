"use client";

import { useState, useTransition } from "react";
import { linkSalesforceUser } from "@/actions/org";
import type { MatchSuggestion } from "@/lib/org";

export function SalesforceMatchScreen({ suggestions }: { suggestions: MatchSuggestion[] }) {
  const [rows, setRows] = useState(suggestions);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function accept(s: MatchSuggestion) {
    if (!s.sfId) return;
    setError("");
    setRows((rs) => rs.filter((r) => r.memberId !== s.memberId));
    startTransition(async () => {
      const res = await linkSalesforceUser(s.memberId, s.sfId);
      if (!res.success) {
        setError(res.error ?? "Could not link");
        setRows(suggestions);
      }
    });
  }

  const band = (score: number | null) =>
    score === null ? { label: "no candidate", cls: "text-muted-foreground" }
    : score >= 0.8 ? { label: "strong", cls: "text-emerald-600 dark:text-emerald-400" }
    : score >= 0.5 ? { label: "likely", cls: "text-amber-600 dark:text-amber-400" }
    : { label: "weak", cls: "text-red-600 dark:text-red-400" };

  const withCandidate = rows.filter((r) => r.sfId);
  const without = rows.filter((r) => !r.sfId);

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">In the app</th>
              <th className="px-3 py-2 font-medium">Best Salesforce match</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {withCandidate.map((s) => {
              const b = band(s.score);
              return (
                <tr key={s.memberId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.fullName ?? s.email}</div>
                    <div className="text-xs text-muted-foreground">{s.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{s.sfName}</div>
                    <div className="text-xs text-muted-foreground">{s.sfEmail}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={b.cls}>{b.label}</span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {s.score?.toFixed(2)} · {s.basis}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="h-7 rounded-md border px-2 text-xs disabled:opacity-50"
                      disabled={pending}
                      onClick={() => accept(s)}
                    >
                      Link
                    </button>
                  </td>
                </tr>
              );
            })}
            {withCandidate.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                Nothing left to review.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {without.length > 0 && (
        <details className="rounded-md border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {without.length} people with no Salesforce match at all
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Nobody in Salesforce resembles them. Usually that means they genuinely have no Salesforce
            account — which is fine, it only means no opportunities or activity will ever be
            attributed to them.
          </p>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {without.map((s) => (
              <li key={s.memberId} className="truncate">
                {s.fullName ?? s.email}
                <span className="ml-1 text-xs text-muted-foreground">{s.email}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-muted-foreground">
        Nothing is linked automatically. Near-misses score high enough to be dangerous — “Matt Cool”
        scores 0.50 against “Matt Beaver” — so every link is a decision someone makes.
      </p>
    </div>
  );
}
