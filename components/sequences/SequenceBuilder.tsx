"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  saveSequenceStep, deleteSequenceStep, setSequenceMode,
  type SequenceStep, type Sequence,
} from "@/actions/sequences";
import { FIELD } from "@/lib/field-class";

type Draft = {
  id?: string;
  position: number;
  offset_days: number;
  channel: "email";
  config: Record<string, string>;
  active: boolean;
};

/**
 * The ladder for any process.
 *
 * One screen for collections, NPS and whatever comes next, because they are the
 * same job: a list of steps, each a number of days after the run began, each
 * doing one thing. Anyone who has used one should not have to learn another.
 *
 * A step off is a step that never fires. That is how they all start, which is
 * why nothing has ever gone out of either ladder.
 */
export function SequenceBuilder({
  sequence, steps, placeholders, senderNote, defaultGap,
}: {
  sequence: Sequence;
  steps: SequenceStep[];
  /** Merge fields this process offers, as {{name}} without the braces. */
  placeholders: string[];
  /** Who the mail comes from, said once where the mode is chosen. */
  senderNote: string;
  /** Days to suggest for a new step, on top of the last one. */
  defaultGap: number;
}) {
  const [rows, setRows] = useState<Draft[]>(steps as Draft[]);
  const [mode, setMode] = useState(sequence.mode);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
    });
  }

  function change(i: number, patch: Partial<Draft>) {
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  }

  function changeConfig(i: number, key: string, value: string) {
    setRows((r) =>
      r.map((row, n) => (n === i ? { ...row, config: { ...row.config, [key]: value } } : row))
    );
  }

  function add() {
    const last = rows[rows.length - 1];
    setRows((r) => [
      ...r,
      {
        position: (last?.position ?? 0) + 1,
        offset_days: (last?.offset_days ?? 0) + defaultGap,
        channel: "email",
        config: { subject: "", body: "" },
        active: false,
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
        <span className="text-sm">When a step comes due</span>
        {([
          ["semi", "leave me a draft"],
          ["full", "send it"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            disabled={pending}
            onClick={() => { setMode(value); run(() => setSequenceMode(sequence.slug, value)); }}
            className={`h-8 rounded-md border px-3 text-sm ${
              mode === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{senderNote}</span>
      </div>

      {rows.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="rounded-md border bg-card p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Step {row.position}</span>
            <label className="flex items-center gap-1 text-sm text-muted-foreground">
              after
              <input
                type="number"
                min={0}
                className={`h-8 w-20 rounded-md border px-2 text-sm ${FIELD}`}
                value={row.offset_days}
                onChange={(e) => change(i, { offset_days: Number(e.target.value) })}
              />
              days
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={row.active}
                onChange={(e) => change(i, { active: e.target.checked })}
              />
              On
            </label>
            <div className="ml-auto flex gap-2">
              <button
                disabled={pending}
                className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
                onClick={() => run(() => saveSequenceStep(sequence.slug, row))}
              >
                Save
              </button>
              <button
                disabled={pending || !row.id}
                className="h-8 rounded-md border px-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
                onClick={() => {
                  setRows((r) => r.filter((_, n) => n !== i));
                  if (row.id) run(() => deleteSequenceStep(sequence.slug, row.id!));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <input
            className={`h-8 w-full rounded-md border px-2 text-sm ${FIELD}`}
            placeholder="Subject"
            value={row.config.subject ?? ""}
            onChange={(e) => changeConfig(i, "subject", e.target.value)}
          />
          <textarea
            className={`min-h-32 w-full rounded-md border p-2 text-sm ${FIELD}`}
            placeholder="Body"
            value={row.config.body ?? ""}
            onChange={(e) => changeConfig(i, "body", e.target.value)}
          />
        </div>
      ))}

      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-xs text-muted-foreground">Merge fields</legend>
        <div className="flex flex-wrap gap-1.5">
          {placeholders.map((p) => (
            <code key={p} className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{${p}}}`}</code>
          ))}
        </div>
      </fieldset>

      <button
        onClick={add}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Add step
      </button>
    </div>
  );
}
