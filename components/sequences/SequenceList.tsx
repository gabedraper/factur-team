"use client";

import { useState } from "react";
import Link from "next/link";
import type { SequenceRow } from "@/actions/sequence-audience";

/**
 * Shared sequences and your own, as two views of one list.
 *
 * A tab rather than two pages: they are the same thing filtered, and a sequence
 * moving from private to shared should not move house.
 */
export function SequenceList({ sequences }: { sequences: SequenceRow[] }) {
  const [tab, setTab] = useState<"shared" | "mine">("shared");

  const shown = sequences.filter((s) =>
    tab === "shared" ? s.visibility === "shared" : s.mine
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {([
          ["shared", "Shared sequences"],
          ["mine", "My sequences"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              tab === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab === "shared" ? "No shared sequences." : "You have no sequences of your own."}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((s) => (
            <Link
              key={s.id}
              href={`/sequences/${s.slug}`}
              className="block rounded-md border bg-card px-4 py-3 hover:bg-muted"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">{s.name}</span>
                {s.visibility === "private" && s.ownerName && (
                  <span className="text-xs text-muted-foreground">{s.ownerName}</span>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {s.enrolled} enrolled · {s.activeSteps} active{" "}
                  {s.activeSteps === 1 ? "step" : "steps"}
                </span>
              </div>
              {s.description && (
                <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
              )}
              {s.activeSteps === 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Every step is off, so nothing will send.
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
