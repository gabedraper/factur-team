"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Send } from "lucide-react";
import {
  saveSequenceStep, deleteSequenceStep, setSequenceMode, setSequenceEndings, testStep,
  saveStepVariant, type SequenceStep, type Sequence, type Writer,
} from "@/actions/sequences";
import { ENDINGS, type Ending } from "@/lib/sequences";
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
  sequence, steps, placeholders, senderNote, defaultGap, writers, writerId,
}: {
  sequence: Sequence;
  steps: SequenceStep[];
  /** People who send this sequence and may word it themselves. */
  writers: Writer[];
  /** Whose wording is on screen. Null is the shared version. */
  writerId: string | null;
  /** Merge fields this process offers, as {{name}} without the braces. */
  placeholders: string[];
  /** Who the mail comes from, said once where the mode is chosen. */
  senderNote: string;
  /** Days to suggest for a new step, on top of the last one. */
  defaultGap: number;
}) {
  /*
   * What is in the boxes: this person's own wording where they have written
   * any, and the shared version where they have not. Saving writes back to
   * whichever of the two is being edited.
   */
  const [rows, setRows] = useState<Draft[]>(
    steps.map((st) => ({
      ...st,
      config: writerId ? { ...st.config, ...(st.variant ?? {}) } : st.config,
    })) as Draft[]
  );
  const own = new Set(steps.filter((st) => st.variant).map((st) => st.id));
  const [mode, setMode] = useState(sequence.mode);
  const [ends, setEnds] = useState<Ending[]>(sequence.ends_on);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ success: boolean; error?: string }>, ok = "") {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
      else if (ok) setNote(ok);
    });
  }

  function toggleEnding(key: Ending, on: boolean) {
    const next = on ? [...ends, key] : ends.filter((e) => e !== key);
    setEnds(next);
    run(() => setSequenceEndings(sequence.slug, next));
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
      {note && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {note}
        </p>
      )}
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

      {writers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
          <span className="text-sm">Wording for</span>
          <select
            className={`h-8 rounded-md border px-2 text-sm ${FIELD}`}
            value={writerId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              window.location.search = v ? `?writer=${v}` : "";
            }}
          >
            <option value="">Everyone (the shared version)</option>
            {writers.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          {writerId && (
            <span className="text-xs text-muted-foreground">
              Blank falls back to the shared version.
            </span>
          )}
        </div>
      )}

      <div className="rounded-md border bg-card p-3">
        <p className="mb-2 text-sm">What stops it</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ENDINGS.filter((e) => !e.only || e.only === sequence.slug).map((e) => (
            <label key={e.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ends.includes(e.key)}
                disabled={pending || e.key === "manual"}
                onChange={(ev) => toggleEnding(e.key, ev.target.checked)}
              />
              <span className={e.key === "manual" ? "text-muted-foreground" : ""}>{e.label}</span>
            </label>
          ))}
        </div>
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
            {writerId && row.id && (
              <span className="text-xs text-muted-foreground">
                {own.has(row.id) ? "their own wording" : "the shared wording"}
              </span>
            )}
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
                onClick={() =>
                  run(() =>
                    writerId && row.id
                      ? saveStepVariant(sequence.slug, row.id, writerId, row.config)
                      : saveSequenceStep(sequence.slug, row)
                  )
                }
              >
                Save
              </button>
              <button
                disabled={pending || !row.id}
                title="Draft this step to yourself"
                className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm disabled:opacity-40"
                onClick={() =>
                  run(
                    () => testStep(sequence.slug, row.id!, writerId),
                    "Drafted to your mailbox."
                  )
                }
              >
                <Send className="h-4 w-4" /> Test
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
