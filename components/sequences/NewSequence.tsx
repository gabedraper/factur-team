"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createSequence } from "@/actions/sequences";
import { FIELD } from "@/lib/field-class";

/**
 * Start a new ladder.
 *
 * A new sequence has steps and nothing to run them against: something has to
 * open a run before anybody receives anything, and that part is written per
 * process. So this makes the ladder, not the machine that feeds it.
 */
export function NewSequence() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm"
      >
        <Plus className="h-4 w-4" /> New sequence
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      <input
        autoFocus
        className={`h-8 w-full rounded-md border px-2 text-sm ${FIELD}`}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={`h-8 w-full rounded-md border px-2 text-sm ${FIELD}`}
        placeholder="What it is for"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          disabled={pending}
          className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
          onClick={() =>
            startTransition(async () => {
              setError("");
              const res = await createSequence(name, description);
              if (!res.success) setError(res.error ?? "Something went wrong");
              else router.push(`/settings/sequences/${res.slug}`);
            })
          }
        >
          Create
        </button>
        <button
          disabled={pending}
          className="h-8 rounded-md border px-3 text-sm text-muted-foreground disabled:opacity-50"
          onClick={() => { setOpen(false); setError(""); }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
