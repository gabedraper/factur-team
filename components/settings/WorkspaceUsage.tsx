"use client";

import { useState, useTransition } from "react";
import {
  workspaceUsageByPerson,
  type WorkspaceUsageReport,
} from "@/actions/workspace-usage";

/**
 * Gmail, Drive, Docs and Chat across the staff list.
 *
 * Button-driven for the same reason the chat report is: the read pages through
 * every account in the domain, and a long Google call inside a server render
 * outruns the function timeout and reads to the browser as a broken page.
 */

const COLUMNS = [
  ["gmail", "Gmail"],
  ["drive", "Drive"],
  ["docs", "Docs"],
  ["chat", "Chat"],
] as const;

function day(value: string | null): string {
  if (!value) return "—";
  // Some parameters are counts rather than timestamps; those pass through.
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

export function WorkspaceUsage() {
  const [report, setReport] = useState<WorkspaceUsageReport | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [pending, start] = useTransition();

  function load() {
    start(async () => setReport(await workspaceUsageByPerson()));
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Workspace usage</h2>
        <button
          onClick={load}
          disabled={pending}
          className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          {pending ? "Reading…" : "Read"}
        </button>
        {report?.date && (
          <span className="text-sm text-muted-foreground">{report.date}</span>
        )}
        {report && !report.problem && report.seen.length > 0 && (
          <button
            onClick={() => setShowParams((s) => !s)}
            className="h-8 rounded-md border px-3 text-sm text-muted-foreground"
          >
            {showParams ? "Hide fields" : `${report.seen.length} fields`}
          </button>
        )}
      </div>

      {report?.problem && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {report.problem}
        </p>
      )}

      {showParams && report && (
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
          {report.seen.join("\n")}
        </pre>
      )}

      {report && !report.problem && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                {COLUMNS.map(([, label]) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Last login</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr
                  key={r.email}
                  className={`border-t ${
                    r.onStaff ? "" : "bg-amber-50/50 dark:bg-amber-950/20"
                  }`}
                >
                  <td className="px-3 py-1.5">
                    {r.name ?? (r.onStaff ? "—" : "Not on staff list")}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.email}</td>
                  {COLUMNS.map(([key]) => {
                    const v = r[key];
                    return (
                      <td
                        key={key}
                        className={`px-3 py-1.5 tabular-nums ${
                          v ? "" : "text-muted-foreground"
                        }`}
                      >
                        {day(v)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                    {day(r.lastLogin)}
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
