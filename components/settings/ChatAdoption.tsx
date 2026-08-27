"use client";

import { useState, useTransition } from "react";
import { chatAdoption, type AdoptionReport } from "@/actions/chat-adoption";

/**
 * Chat adoption, read from the domain audit log.
 *
 * Driven from a button rather than loaded with the page. The read walks up to
 * twenty pages of Google's log, and the ingest already established what a long
 * Google sweep does to a server render: it outruns the function timeout and
 * the browser calls it a failed page, which is indistinguishable from a crash.
 */
export function ChatAdoption() {
  const [report, setReport] = useState<AdoptionReport | null>(null);
  const [days, setDays] = useState(30);
  const [pending, start] = useTransition();

  function load() {
    start(async () => setReport(await chatAdoption(days)));
  }

  const used = report?.people.filter((p) => p.messages > 0).length ?? 0;
  const total = report?.people.length ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Chat activity</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-8 rounded-md border bg-field px-2 text-sm"
        >
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
          <span className="text-sm text-muted-foreground">
            {used} of {total}
            {report.truncated ? " · partial" : ""}
          </span>
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
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 text-right font-medium">Messages</th>
                <th className="px-3 py-2 font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {report.people.map((p) => (
                <tr key={p.email} className="border-t">
                  <td className="px-3 py-1.5">{p.name ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{p.email}</td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      p.messages === 0 ? "text-muted-foreground" : ""
                    }`}
                  >
                    {p.messages}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {p.lastActive ? p.lastActive.slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
              {report.strangers.map((p) => (
                <tr key={p.email} className="border-t bg-amber-50/50 dark:bg-amber-950/20">
                  <td className="px-3 py-1.5 text-muted-foreground">Not on staff list</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{p.email}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.messages}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {p.lastActive ? p.lastActive.slice(0, 10) : "—"}
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
