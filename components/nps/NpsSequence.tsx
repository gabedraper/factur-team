"use client";

import { useState, useTransition } from "react";
import { deleteNpsStep, saveNpsStep, setNpsMode, type Settings, type Step } from "@/actions/nps-sequence";
import { PLACEHOLDERS } from "@/lib/nps/render";

const BLANK = { position: 1, days_after_send: 0, subject: "", body: "", active: false };

/**
 * The ladder: what each email says and how long after the invitation it goes.
 *
 * Step one sits at day zero and is the invitation itself, which is why the
 * days on it cannot be anything else -- there is nothing to count from until
 * it has been sent.
 */
export function NpsSequence({
  steps,
  settings,
}: {
  steps: Step[];
  settings: Settings;
}) {
  const [rows, setRows] = useState(steps);
  const [mode, setMode] = useState(settings.mode);
  const [editing, setEditing] = useState<(Partial<Step> & typeof BLANK) | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    if (!editing) return;
    setError("");
    startTransition(async () => {
      const res = await saveNpsStep({
        id: editing.id,
        position: editing.position,
        days_after_send: editing.days_after_send,
        subject: editing.subject,
        body: editing.body,
        active: editing.active,
      });
      if (!res.success) { setError(res.error ?? "Couldn't save that."); return; }
      setEditing(null);
      location.reload();
    });
  }

  function toggle(step: Step) {
    setError("");
    setRows((rs) => rs.map((r) => (r.id === step.id ? { ...r, active: !r.active } : r)));
    startTransition(async () => {
      const res = await saveNpsStep({ ...step, active: !step.active });
      if (!res.success) {
        setRows((rs) => rs.map((r) => (r.id === step.id ? { ...r, active: step.active } : r)));
        setError(res.error ?? "Couldn't save that.");
      }
    });
  }

  function remove(step: Step) {
    setError("");
    setRows((rs) => rs.filter((r) => r.id !== step.id));
    startTransition(async () => {
      const res = await deleteNpsStep(step.id);
      if (!res.success) { setError(res.error ?? "Couldn't remove that."); location.reload(); }
    });
  }

  function changeMode(next: "semi" | "full") {
    const previous = mode;
    setMode(next);
    startTransition(async () => {
      const res = await setNpsMode(next);
      if (!res.success) { setMode(previous); setError(res.error ?? "Couldn't change that."); }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => changeMode(e.target.value as "semi" | "full")}
          className="h-8 rounded-md border bg-field px-2 text-sm"
        >
          <option value="semi">Draft into the team lead&rsquo;s mailbox</option>
          <option value="full">Send straight out</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {PLACEHOLDERS.map((p) => `{{${p}}}`).join("  ")}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.id} className="rounded-md border bg-card px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
                Step {s.position}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {s.days_after_send === 0 ? "on send" : `day ${s.days_after_send}`}
              </span>
              <span className="font-medium">{s.subject}</span>
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input type="checkbox" checked={s.active} onChange={() => toggle(s)} />
                  Active
                </label>
                <button
                  onClick={() => setEditing({ ...BLANK, ...s })}
                  className="h-8 rounded-md border px-3 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(s)}
                  disabled={pending}
                  className="text-xs text-muted-foreground underline hover:text-destructive"
                >
                  remove
                </button>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      {editing ? (
        <div className="space-y-2 rounded-md border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-muted-foreground">
              Position
              <input
                type="number"
                min={1}
                value={editing.position}
                onChange={(e) => setEditing({ ...editing, position: Number(e.target.value) })}
                className="mt-1 block h-8 w-20 rounded-md border bg-field px-2 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Days after send
              <input
                type="number"
                min={0}
                value={editing.days_after_send}
                onChange={(e) =>
                  setEditing({ ...editing, days_after_send: Number(e.target.value) })
                }
                className="mt-1 block h-8 w-28 rounded-md border bg-field px-2 text-sm"
              />
            </label>
            <label className="flex-1 text-xs text-muted-foreground">
              Subject
              <input
                value={editing.subject}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                className="mt-1 block h-8 w-full rounded-md border bg-field px-2 text-sm"
              />
            </label>
          </div>
          <textarea
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={10}
            className="block w-full rounded-md border bg-field px-3 py-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={pending}
              className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={() => setEditing(null)} className="h-8 rounded-md border px-3 text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() =>
            setEditing({ ...BLANK, position: Math.max(0, ...rows.map((r) => r.position)) + 1 })
          }
          className="h-8 rounded-md border px-3 text-sm"
        >
          Add a step
        </button>
      )}
    </div>
  );
}
