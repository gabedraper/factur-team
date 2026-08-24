"use client";

import { useState, useTransition } from "react";
import { recordNps, deleteNps, type NpsEntry } from "@/actions/nps";

/**
 * The NPS log for one client: every response, newest first, plus a way to add
 * the next one.
 *
 * The list is the point. A single number says little -- 7 is encouraging from a
 * client who gave 4 last quarter and alarming from one who gave 10.
 */
export function NpsPanel({
  clientId, entries, canEdit,
}: { clientId: string; entries: NpsEntry[]; canEdit: boolean }) {
  const [rows, setRows] = useState(entries);
  const [score, setScore] = useState("");
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [respondent, setRespondent] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    setError("");
    startTransition(async () => {
      const res = await recordNps(clientId, Number(score), on, respondent, comment);
      if (!res.success) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      setRows((r) => [
        { id: crypto.randomUUID(), score: Number(score), collected_on: on,
          respondent: respondent.trim() || null, comment: comment.trim() || null },
        ...r,
      ]);
      setScore(""); setRespondent(""); setComment("");
    });
  }

  function remove(id: string) {
    setError("");
    setRows((r) => r.filter((x) => x.id !== id));
    startTransition(async () => {
      const res = await deleteNps(id, clientId);
      if (!res.success) setError(res.error ?? "Couldn't remove that.");
    });
  }

  // Movement against the response before it, which is what a score is for.
  const change = (i: number) =>
    i + 1 < rows.length ? rows[i].score - rows[i + 1].score : null;

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Score
            <input type="number" min={0} max={10} value={score}
                   onChange={(e) => setScore(e.target.value)}
                   className="mt-1 block h-8 w-20 rounded-md border bg-field px-2 text-sm" />
          </label>
          <label className="text-xs text-muted-foreground">
            Collected
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)}
                   className="mt-1 block h-8 rounded-md border bg-field px-2 text-sm" />
          </label>
          <label className="flex-1 text-xs text-muted-foreground">
            Who answered
            <input value={respondent} onChange={(e) => setRespondent(e.target.value)}
                   className="mt-1 block h-8 w-full rounded-md border bg-field px-2 text-sm" />
          </label>
          <label className="flex-1 text-xs text-muted-foreground">
            Comment
            <input value={comment} onChange={(e) => setComment(e.target.value)}
                   className="mt-1 block h-8 w-full rounded-md border bg-field px-2 text-sm" />
          </label>
          <button onClick={add} disabled={pending || score === ""}
                  className="h-8 rounded-md border px-3 text-sm disabled:opacity-50">
            Record
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No NPS recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Change</th>
              <th className="px-3 py-2 font-medium">Who</th>
              <th className="px-3 py-2 font-medium">Comment</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const d = change(i);
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 tabular-nums">{r.collected_on}</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{r.score}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {d === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={d > 0 ? "text-emerald-600 dark:text-emerald-400"
                                             : d < 0 ? "text-red-600 dark:text-red-400"
                                                     : "text-muted-foreground"}>
                        {d > 0 ? `+${d}` : d}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.respondent ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.comment ?? "—"}</td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => remove(r.id)} disabled={pending}
                              className="text-xs text-muted-foreground underline hover:text-destructive">
                        remove
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
