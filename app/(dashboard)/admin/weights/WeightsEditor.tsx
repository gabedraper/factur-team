"use client";

import { useState, useTransition } from "react";
import { updateWeights } from "./actions";

type Weight = { effort_source: string; points: number; description: string | null };

export function WeightsEditor({ weights }: { weights: Weight[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(weights.map((w) => [w.effort_source, String(w.points)]))
  );
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const isDirty = weights.some(
    (w) => values[w.effort_source] !== String(w.points)
  );

  const handleSave = () => {
    const updates = weights
      .filter((w) => values[w.effort_source] !== String(w.points))
      .map((w) => ({
        effort_source: w.effort_source,
        points: Number(values[w.effort_source]),
      }));

    startTransition(async () => {
      await updateWeights(updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  };

  return (
    <div>
      <div className="divide-y divide-neutral-900">
        {weights.map((w) => (
          <div key={w.effort_source} className="flex items-center gap-4 py-3">
            <div className="flex-1">
              <p className="text-sm">{w.effort_source}</p>
              {w.description && (
                <p className="text-xs text-neutral-500">{w.description}</p>
              )}
            </div>
            <input
              type="number"
              step="0.25"
              value={values[w.effort_source]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [w.effort_source]: e.target.value }))
              }
              className="w-20 rounded-md border bg-field px-2 py-1 text-sm text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!isDirty || isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </div>
  );
}
