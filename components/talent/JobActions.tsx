"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Plus, X } from "lucide-react";
import { addCandidate, publishJob } from "@/actions/talent-jobs";
import { PersonPicker, type PickedPerson } from "@/components/talent/PersonPicker";
import { Button } from "@/components/ui/button";

/**
 * Putting somebody on a search.
 *
 * The panel stays open after each pick and keeps a running list, because adding
 * candidates is something people do six at a time and closing after one would
 * mean reopening it five times.
 */
export function AddCandidate({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<{ name: string; already: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function pick(p: PickedPerson) {
    setError(null);
    start(async () => {
      try {
        const res = await addCandidate(jobId, p.id);
        setAdded((a) => [{ name: p.name, already: res.alreadyThere }, ...a]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add them");
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add candidate
      </Button>
    );
  }

  return (
    <div className="w-80 rounded-lg border bg-card p-3 shadow-lg">
      <div className="mb-2 flex items-center">
        <span className="text-sm font-medium">Add candidate</span>
        <button
          type="button"
          onClick={() => { setOpen(false); setAdded([]); }}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <PersonPicker onPick={pick} autoFocus />

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {added.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {added.map((a, i) => (
            <li key={i}>
              {a.name} — {a.already ? "already on this job" : "added"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Publishing to the careers page.
 *
 * The database refuses a confidential or non-active job, and so does the action
 * behind this. The button is disabled here as well so the refusal is visible
 * before it is clicked rather than after.
 */
export function PublishToggle({
  jobId, published, confidential, status, careersEnabled, slug,
}: {
  jobId: string;
  published: boolean;
  confidential: boolean;
  status: string;
  careersEnabled: boolean;
  slug: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const blocked = confidential
    ? "Confidential"
    : status !== "active"
      ? "Needs an active status"
      : !careersEnabled
        ? "Careers page is off"
        : null;

  function toggle() {
    setError(null);
    start(async () => {
      try {
        await publishJob(jobId, !published);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change that");
      }
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={published ? "secondary" : "outline"}
          onClick={toggle}
          disabled={pending || (!published && !!blocked)}
        >
          <Globe className="mr-1.5 h-4 w-4" />
          {published ? "Unpublish" : "Publish"}
        </Button>
        {published && slug && (
          <a
            href={`/careers/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            /careers/{slug}
          </a>
        )}
        {!published && blocked && (
          <span className="text-xs text-muted-foreground">{blocked}</span>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
