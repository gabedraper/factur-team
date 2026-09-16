"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editTask } from "@/actions/work-detail";
import type { TaskDetail, TaskEdit } from "@/lib/work-detail";
import { control } from "@/components/ui/control";

/**
 * The properties you can change without leaving the page.
 *
 * Status, dates and priority: the three things somebody reading a task beside
 * its client actually changes, and the reason the answer used to be "I will
 * have to go into ClickUp". Everything else here -- comments, subtasks,
 * attachments -- is still a link to do it over there.
 *
 * Each control saves the moment it changes. A property grid with an edit button
 * and a save button would be two more clicks on the thing that was already
 * losing to a tab switch.
 */

/** yyyy-mm-dd, which is what <input type="date"> takes. Stored value is UTC. */
const day = (v: string | null) => (v ? v.slice(0, 10) : "");

const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

/**
 * One control, and its value while ClickUp is being told about it.
 *
 * The picked value is held here rather than read back from the server on every
 * change: a control that snaps to its old value for as long as ClickUp takes
 * to answer reads as an edit that did not work. Refused, it goes back to what
 * it was and says why; accepted, the page re-renders from ClickUp's own answer
 * so what you are left looking at is what ClickUp now holds.
 */
function useField<T extends string>(
  clickupId: string,
  actual: T,
  edit: (value: T) => TaskEdit,
) {
  const router = useRouter();
  const [value, setValue] = useState<T>(actual);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  function pick(next: T) {
    setValue(next);
    setError(null);
    start(async () => {
      const res = await editTask(clickupId, edit(next));
      if (!res.ok) { setValue(actual); setError(res.error); return; }
      router.refresh();
    });
  }

  return { value, pick, saving, error };
}

/* A refused save says so beside the control that was refused. At the top of the
 * page it would be a sentence about something you have already looked away
 * from. */
function Failed({ error }: { error: string | null }) {
  return error ? <span className="text-meta text-destructive">{error}</span> : null;
}

export function StatusField({ t }: { t: TaskDetail }) {
  const { value, pick, saving, error } = useField(t.clickupId, t.status, (status) => ({ status }));

  /* A status the list no longer offers is still the one this task is on, and
   * leaving it out would make the select show somebody else's status. */
  const options = t.statuses.some((s) => s.status === t.status)
    ? t.statuses
    : [{ status: t.status, color: t.statusColor, type: t.statusType }, ...t.statuses];
  const color = options.find((s) => s.status === value)?.color ?? null;

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Status"
        className={control({ size: "sm", className: "w-48 font-semibold uppercase tracking-wide" })}
        value={value}
        disabled={saving}
        style={color ? { color } : undefined}
        onChange={(e) => pick(e.target.value)}
      >
        {options.map((s) => (
          <option key={s.status} value={s.status} style={s.color ? { color: s.color } : undefined}>
            {s.status}
          </option>
        ))}
      </select>
      <Failed error={error} />
    </span>
  );
}

export function DatesField({ t, overdue }: { t: TaskDetail; overdue: boolean }) {
  const start = useField(t.clickupId, day(t.startAt), (d) => ({ startOn: d || null }));
  const due = useField(t.clickupId, day(t.dueAt), (d) => ({ dueOn: d || null }));

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        aria-label="Start date"
        className={control({ size: "sm", className: "w-40 tabular-nums" })}
        value={start.value}
        disabled={start.saving}
        onChange={(e) => start.pick(e.target.value)}
      />
      <span className="text-muted-foreground" aria-hidden>→</span>
      <input
        type="date"
        aria-label="Due date"
        className={control({ size: "sm", className: `w-40 tabular-nums ${overdue ? "text-destructive" : ""}` })}
        value={due.value}
        disabled={due.saving}
        onChange={(e) => due.pick(e.target.value)}
      />
      <Failed error={start.error ?? due.error} />
    </span>
  );
}

export function PriorityField({ t }: { t: TaskDetail }) {
  const { value, pick, saving, error } = useField(
    t.clickupId,
    t.priority ?? "",
    (p) => ({ priority: (p || null) as TaskEdit["priority"] }),
  );

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Priority"
        className={control({ size: "sm", className: "w-40 capitalize" })}
        value={value}
        disabled={saving}
        style={t.priorityColor && value === t.priority ? { color: t.priorityColor } : undefined}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="">No priority</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <Failed error={error} />
    </span>
  );
}
