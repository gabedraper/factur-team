"use client";

import { useState, useTransition } from "react";
import { saveStep, deleteStep, setMode, type Step, type Settings } from "@/actions/collections";
import { PLACEHOLDERS } from "@/lib/collections/render";
import { Plus, Trash2 } from "lucide-react";

/*
 * Every editable field on this screen, tinted so the parts you can type into
 * are obvious against the cards they sit on. Held in one place because four
 * inputs drifting apart is exactly how a screen starts looking untidy.
 */
const FIELD =
  "rounded-md border border-sky-200 bg-sky-50 text-foreground " +
  "placeholder:text-sky-900/40 focus:outline-none focus:ring-2 focus:ring-sky-400 " +
  "dark:border-sky-900 dark:bg-sky-950/40 dark:placeholder:text-sky-100/30";

type Draft = {
  id?: string;
  position: number;
  days_past_due: number;
  subject: string;
  body: string;
  active: boolean;
};

/**
 * The ladder, and the switch that decides whether a due email becomes a draft
 * in her mailbox or goes straight out.
 *
 * A step off is a step that never fires. That is how they all start.
 */
export function Sequence({ steps, settings }: { steps: Step[]; settings: Settings }) {
  const [rows, setRows] = useState<Draft[]>(steps);
  const [mode, setModeLocal] = useState(settings.mode);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function change(i: number, patch: Partial<Draft>) {
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  }

  function save(i: number) {
    setError("");
    startTransition(async () => {
      const res = await saveStep(rows[i]);
      if (!res.success) setError(res.error ?? "Couldn't save that step.");
    });
  }

  function remove(i: number) {
    const row = rows[i];
    setRows((r) => r.filter((_, n) => n !== i));
    if (!row.id) return;
    startTransition(async () => {
      const res = await deleteStep(row.id as string);
      if (!res.success) setError(res.error ?? "Couldn't delete that step.");
    });
  }

  function add() {
    setRows((r) => [
      ...r,
      {
        position: r.length + 1,
        days_past_due: (r[r.length - 1]?.days_past_due ?? 0) + 14,
        subject: "",
        body: "",
        active: false,
      },
    ]);
  }

  function switchMode(next: "semi" | "full") {
    setModeLocal(next);
    startTransition(async () => {
      const res = await setMode(next);
      if (!res.success) {
        setError(res.error ?? "Couldn't change the mode.");
        setModeLocal(mode);
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {(["semi", "full"] as const).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            disabled={pending}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {m === "semi" ? "Semi-auto" : "Full auto"}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">{settings.send_as}</span>
      </div>

      <fieldset className="rounded-lg border px-3 pb-3 pt-1">
        <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
          Available Merge Fields
        </legend>
        <div className="flex flex-wrap gap-1">
          {PLACEHOLDERS.map((p) => (
            <code key={p} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {`{{${p}}}`}
            </code>
          ))}
        </div>
      </fieldset>

      {rows.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              Step
              <input
                type="number"
                value={row.position}
                onChange={(e) => change(i, { position: Number(e.target.value) })}
                className={`${FIELD} w-14 px-2 py-1 tabular-nums`}
              />
            </label>
            <label className="flex items-center gap-1">
              Day
              <input
                type="number"
                value={row.days_past_due}
                onChange={(e) => change(i, { days_past_due: Number(e.target.value) })}
                className={`${FIELD} w-16 px-2 py-1 tabular-nums`}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={row.active}
                onChange={(e) => change(i, { active: e.target.checked })}
              />
              Active
            </label>
            <span className="ml-auto flex gap-2">
              <button
                onClick={() => save(i)}
                disabled={pending}
                className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => remove(i)}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </span>
          </div>

          <input
            value={row.subject}
            placeholder="Subject"
            onChange={(e) => change(i, { subject: e.target.value })}
            className={`${FIELD} w-full px-2 py-1 text-sm`}
          />
          <textarea
            value={row.body}
            rows={12}
            placeholder="Body"
            onChange={(e) => change(i, { body: e.target.value })}
            className={`${FIELD} w-full px-2 py-1 font-mono text-xs leading-relaxed`}
          />
        </div>
      ))}

      <button
        onClick={add}
        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        <Plus className="h-4 w-4" /> Add step
      </button>
    </div>
  );
}
