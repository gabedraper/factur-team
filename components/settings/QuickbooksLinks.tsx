"use client";

import { useState, useTransition } from "react";
import { decideQuickbooksLink, type UnmatchedCustomer } from "@/actions/quickbooks-links";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/**
 * QuickBooks customers who owe money and belong to no client.
 *
 * Sorted by what is owed, because the point of the screen is that a debt cannot
 * hide behind a spelling. The suggestion is a hint: it gets Mako Plastics right
 * at 0.71 and Ballco Manufacturing wrong at 0.56, so nothing is linked until
 * somebody says so.
 */
export function QuickbooksLinks({
  rows, clients, canDecide,
}: {
  rows: UnmatchedCustomer[];
  clients: { id: string; name: string }[];
  canDecide: boolean;
}) {
  const [left, setLeft] = useState(rows);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(name: string, clientId: string | null) {
    setError("");
    setLeft((r) => r.filter((x) => x.qb_customer_name !== name));
    startTransition(async () => {
      const res = await decideQuickbooksLink(name, clientId);
      if (!res.success) {
        setError(res.error ?? "Couldn't save that.");
        setLeft(rows);
      }
    });
  }

  const owed = left.reduce((n, r) => n + Number(r.owed), 0);
  const overdue = left.reduce((n, r) => n + Number(r.overdue_60_plus), 0);

  if (left.length === 0) {
    return <p className="text-sm text-muted-foreground">Every customer who owes money is tied to a client.</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <p className="text-sm">
        <b>{money.format(owed)}</b> owed by {left.length} customers nobody is watching
        {overdue > 0 && <> — <span className="text-red-600 dark:text-red-400">{money.format(overdue)} of it past 60 days</span></>}
      </p>

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">In QuickBooks</th>
              <th className="px-3 py-2 font-medium text-right">Owed</th>
              <th className="px-3 py-2 font-medium text-right">Past 60 days</th>
              <th className="px-3 py-2 font-medium">Salesforce Client</th>
              {canDecide && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {left.map((r) => (
              <tr key={r.qb_customer_name} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.qb_customer_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money.format(r.owed)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${
                  r.overdue_60_plus > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                }`}>
                  {r.overdue_60_plus > 0 ? money.format(r.overdue_60_plus) : "—"}
                </td>
                <td className="px-3 py-2">
                  {canDecide ? (
                    <select
                      className="h-8 w-64 rounded-md border bg-field px-2 text-sm"
                      value={choice[r.qb_customer_name] ?? r.suggested_client_id ?? ""}
                      onChange={(e) =>
                        setChoice((c) => ({ ...c, [r.qb_customer_name]: e.target.value }))
                      }
                    >
                      <option value="">— nobody —</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.id === r.suggested_client_id && r.score !== null
                            ? `  (closest, ${r.score})`
                            : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted-foreground">
                      {r.suggested_client_name ?? "—"}
                      {r.score !== null && <> ({r.score})</>}
                    </span>
                  )}
                </td>
                {canDecide && (
                  <td className="px-3 py-2 text-right">
                    <button
                      disabled={pending}
                      onClick={() =>
                        decide(
                          r.qb_customer_name,
                          (choice[r.qb_customer_name] ?? r.suggested_client_id ?? "") || null
                        )
                      }
                      className="h-7 rounded-md border px-2 text-xs disabled:opacity-50"
                    >
                      Save
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
