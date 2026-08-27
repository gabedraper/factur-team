"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import { quickSearchJobs } from "@/actions/talent";
import { addCandidate } from "@/actions/talent-jobs";
import { Button } from "@/components/ui/button";

/** Puts this person on a search, from their own profile. */
export function AddToJob({ personId }: { personId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; title: string; company_name: string | null }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    start(async () => setJobs(await quickSearchJobs("", 25)));
  }, [open]);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Briefcase className="mr-1.5 h-4 w-4" />
        Add to job
      </Button>
    );
  }

  return (
    <div className="w-72 rounded-lg border bg-card p-2 shadow-lg">
      {note && <p className="px-2 pb-2 text-xs text-muted-foreground">{note}</p>}
      <ul className="max-h-64 divide-y overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.id}>
            <button
              type="button"
              className="w-full px-2 py-2 text-left text-sm hover:bg-accent"
              onClick={() => start(async () => {
                const res = await addCandidate(j.id, personId);
                setNote(res.alreadyThere ? `Already on ${j.title}` : `Added to ${j.title}`);
                router.refresh();
              })}
            >
              <span className="block truncate font-medium">{j.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{j.company_name ?? "—"}</span>
            </button>
          </li>
        ))}
        {jobs.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No open jobs</li>}
      </ul>
      <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => { setOpen(false); setNote(null); }}>
        Close
      </Button>
    </div>
  );
}
