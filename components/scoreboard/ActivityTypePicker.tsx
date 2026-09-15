"use client";

import { useState, useTransition } from "react";
import { setActivityType } from "@/actions/scoreboard";
import { control } from "@/components/ui/control";

export function ActivityTypePicker({
  activityId,
  current,
  types,
  overridden,
  overriddenBySubject,
  originalEffortSource,
  setByEmail,
  hasSubject,
}: {
  activityId: string;
  current: string;
  types: string[];
  overridden: boolean;
  overriddenBySubject: boolean;
  originalEffortSource: string | null;
  setByEmail: string | null;
  hasSubject: boolean;
}) {
  const [applyToSubject, setApplyToSubject] = useState(overriddenBySubject);
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(next: string | null) {
    setError(null);
    setValue(next ?? originalEffortSource ?? current);
    startTransition(async () => {
      const res = await setActivityType(activityId, next, applyToSubject && hasSubject);
      if (!res.success) {
        setValue(current);
        setError(res.error ?? "Couldn't save.");
      }
    });
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => submit(e.target.value)}
        /* Amber marks a type somebody has overridden by hand. */
        className={control({
          size: "sm",
          className: `text-meta ${overridden ? "border-warning text-warning" : ""}`,
        })}
      >
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {hasSubject && (
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={applyToSubject}
            disabled={pending}
            onChange={(e) => setApplyToSubject(e.target.checked)}
            className="h-3 w-3 accent-amber-500"
          />
          All with this subject
        </label>
      )}

      {overridden && (
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(null)}
          className="text-[10px] text-muted-foreground underline decoration-dotted hover:text-foreground disabled:opacity-50"
          title={
            [originalEffortSource ? `Was ${originalEffortSource}` : null, setByEmail]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        >
          Reset
        </button>
      )}

      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </span>
  );
}
