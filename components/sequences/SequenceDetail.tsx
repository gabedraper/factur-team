"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { workSequence, type AudienceRow, type SequenceRow } from "@/actions/sequence-audience";

/**
 * Who is in a sequence, and the two ways to work whatever is due.
 *
 * The buttons are the choice, not a setting: "Send to all" sends, "Leave drafts
 * in my inbox" puts every one of them in front of the person pressing the
 * button first. A hundred emails are much easier to judge as a hundred drafts
 * than as a description of a hundred emails.
 */
export function SequenceDetail({
  sequence,
  audience,
  dueCount,
}: {
  sequence: SequenceRow;
  audience: AudienceRow[];
  dueCount: number;
}) {
  const [rows] = useState(audience);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function work(mode: "send" | "draft-to-me") {
    setError(""); setNote("");
    startTransition(async () => {
      const res = await workSequence(sequence.slug, mode);
      if (!res.success) { setError(res.error ?? "That didn't run."); return; }
      setNote(
        mode === "send"
          ? `Sent ${res.done}.` + (res.failed ? ` ${res.failed} failed.` : "")
          : `${res.done} drafts are in your inbox.` +
            (res.failed ? ` ${res.failed} failed.` : "") +
            " Nothing has gone to anyone yet."
      );
    });
  }

  const enrolled = rows.filter((r) => r.enrolled).length;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/sequences/${sequence.slug}/add`}
          className="h-9 rounded-md bg-primary px-4 text-sm leading-9 text-primary-foreground hover:bg-primary/90"
        >
          Add contacts
        </Link>
        <span className="text-sm text-muted-foreground">
          {enrolled} enrolled · {dueCount} due now
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => work("draft-to-me")}
            disabled={pending || dueCount === 0}
            className="h-9 rounded-md border px-4 text-sm disabled:opacity-50"
          >
            Leave drafts in my inbox
          </button>
          <button
            onClick={() => work("send")}
            disabled={pending || dueCount === 0}
            className="h-9 rounded-md border px-4 text-sm disabled:opacity-50"
          >
            Send to all
          </button>
        </div>
      </div>

      {sequence.activeSteps === 0 && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Every step is switched off, so nothing is due. Turn one on in Settings → Sequences.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">In sequence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  {[r.firstName, r.lastName].filter(Boolean).join(" ") || (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.email}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.clientName ?? r.company ?? "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.source === "csv" ? "CSV" : "App contacts"}
                </td>
                <td className="px-3 py-2">
                  {r.enrolled ? (
                    <span className="text-emerald-600 dark:text-emerald-400">Active</span>
                  ) : (
                    <span className="text-muted-foreground">Finished</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Nobody in this sequence yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
