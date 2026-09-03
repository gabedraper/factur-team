"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { saveCampaign } from "@/actions/talent-engage";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/lib/field-class";

export function NewCampaign({ jobs }: { jobs: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [jobId, setJobId] = useState("");
  const [audience, setAudience] = useState("candidate");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New campaign
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-6 pt-24">
      <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4 shadow-xl">
        <div className="flex items-center">
          <h2 className="text-sm font-semibold">New campaign</h2>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto" aria-label="Close">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <input
          className={`w-full px-2 py-1.5 text-sm ${FIELD}`}
          placeholder="Name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
        >
          <option value="">No job</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.title}</option>
          ))}
        </select>
        <select
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          <option value="candidate">Candidates</option>
          <option value="client">Clients</option>
        </select>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending || !name.trim()}
            onClick={() => start(async () => {
              const result = await saveCampaign({ name, job_id: jobId || null, audience });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.push(`/talent/campaigns/${result.id}`);
              router.refresh();
            })}
          >
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
