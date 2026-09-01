"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Send, Mail, Check } from "lucide-react";
import {
  saveSequenceStep, deleteSequenceStep, setSequenceMode, setSequenceEndings, testStep,
  saveStepVariant, type SequenceStep, type Sequence, type Writer,
} from "@/actions/sequences";
import { ENDINGS, type Ending } from "@/lib/sequences";
import { FIELD } from "@/lib/field-class";
import RichTextEditor from "@/components/rich-text-editor";

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
 * Laid out as three columns -- the steps, the one being written, and its
 * settings. Every step used to be expanded down a single page, which meant
 * four rich text editors stacked on top of each other and no way to see the
 * shape of the ladder without scrolling past its contents.
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

  const [tab, setTab] = useState<"steps" | "settings">("steps");
  const [selected, setSelected] = useState(0);
  /*
   * Which steps have been edited and not yet saved.
   *
   * Only visible because the steps are now a list: an edit made on step two
   * and left there is invisible from step three, so the list has to say so or
   * the work looks lost.
   */
  const [dirty, setDirty] = useState<Set<number>>(new Set());

  const [mode, setMode] = useState(sequence.mode);
  const [ends, setEnds] = useState<Ending[]>(sequence.ends_on);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const step: Draft | undefined = rows[selected];
  const span = rows.length ? Math.max(...rows.map((r) => r.offset_days)) : 0;

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

  function touch(i: number) {
    setDirty((d) => new Set(d).add(i));
  }

  function change(i: number, patch: Partial<Draft>) {
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));
    touch(i);
  }

  function changeConfig(i: number, key: string, value: string) {
    setRows((r) =>
      r.map((row, n) => (n === i ? { ...row, config: { ...row.config, [key]: value } } : row))
    );
    touch(i);
  }

  function save(i: number) {
    const row = rows[i];
    setError("");
    setNote("");
    startTransition(async () => {
      const res =
        writerId && row.id
          ? await saveStepVariant(sequence.slug, row.id, writerId, row.config)
          : await saveSequenceStep(sequence.slug, row);
      if (!res.success) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      setDirty((d) => {
        const next = new Set(d);
        next.delete(i);
        return next;
      });
    });
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
    setSelected(rows.length);
  }

  function remove(i: number) {
    const row = rows[i];
    setRows((r) => r.filter((_, n) => n !== i));
    setSelected((s) => Math.max(0, s > i ? s - 1 : s === i ? Math.min(i, rows.length - 2) : s));
    if (row.id) run(() => deleteSequenceStep(sequence.slug, row.id!));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b">
        {([["steps", "Steps"], ["settings", "Settings"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {note && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {note}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {tab === "settings" ? (
        <div className="max-w-2xl space-y-3">
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
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* The ladder itself: every step at a glance, none of their contents. */}
          <div className="w-full shrink-0 space-y-2 lg:w-72">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {rows.length} {rows.length === 1 ? "step" : "steps"}
              {span > 0 && `, ${span} days`}
            </p>

            <ol className="space-y-1">
              {rows.map((row, i) => (
                <li key={row.id ?? `new-${i}`}>
                  <button
                    onClick={() => setSelected(i)}
                    className={`flex w-full items-start gap-2 rounded-md border p-3 text-left transition-colors ${
                      i === selected
                        ? "border-primary bg-accent"
                        : "bg-card hover:bg-accent/50"
                    }`}
                  >
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {row.position}. Email
                        {dirty.has(i) && (
                          <span
                            title="Unsaved"
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                          />
                        )}
                        {!row.active && (
                          <span className="text-xs font-normal text-muted-foreground">off</span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.config.subject?.trim() || "No subject"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      Day {row.offset_days}
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <button
              onClick={add}
              disabled={pending}
              className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add step
            </button>
          </div>

          {/* The step being written. */}
          {step ? (
            <div className="min-w-0 flex-1 space-y-3 rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 border-b pb-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{step.position}. Email</span>
                <span className="text-xs text-muted-foreground">{senderNote}</span>
                {writerId && step.id && (
                  <span className="text-xs text-muted-foreground">
                    · {own.has(step.id) ? "their own wording" : "the shared wording"}
                  </span>
                )}
              </div>

              <input
                className={`h-9 w-full rounded-md border px-3 text-sm ${FIELD}`}
                placeholder="Subject"
                value={step.config.subject ?? ""}
                onChange={(e) => changeConfig(selected, "subject", e.target.value)}
              />

              <RichTextEditor
                value={step.config.body ?? ""}
                onChange={(html) => changeConfig(selected, "body", html)}
                placeholder="Body"
              />

              <div className="flex flex-wrap gap-1.5">
                {placeholders.map((p) => (
                  <code
                    key={p}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                  >{`{{${p}}}`}</code>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <button
                  disabled={pending}
                  onClick={() => save(selected)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  {dirty.has(selected) ? "Save" : "Saved"}
                </button>
                <button
                  disabled={pending || !step.id}
                  title="Draft this step to yourself"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm disabled:opacity-40"
                  onClick={() =>
                    run(
                      () => testStep(sequence.slug, step.id!, writerId),
                      "Drafted to your mailbox."
                    )
                  }
                >
                  <Send className="h-4 w-4" /> Test
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-center rounded-md border border-dashed p-12 text-sm text-muted-foreground">
              No steps yet.
            </div>
          )}

          {/* What this step does, as opposed to what it says. */}
          {step && (
            <div className="w-full shrink-0 space-y-3 rounded-md border bg-card p-4 lg:w-64">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Step settings
              </p>

              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Days after start</span>
                <input
                  type="number"
                  min={0}
                  className={`h-9 w-full rounded-md border px-3 text-sm ${FIELD}`}
                  value={step.offset_days}
                  onChange={(e) => change(selected, { offset_days: Number(e.target.value) })}
                />
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={step.active}
                  onChange={(e) => change(selected, { active: e.target.checked })}
                />
                On
              </label>

              <button
                disabled={pending}
                onClick={() => remove(selected)}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" /> Delete step
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
