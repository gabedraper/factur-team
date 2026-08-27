"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logActivity } from "@/actions/talent";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/lib/field-class";
import type { ActivityType } from "@/lib/talent/types";

/**
 * The composer at the top of a timeline.
 *
 * A note template drops its text into the box rather than filing it directly,
 * so an intake note is a starting point somebody edits and not a form that
 * files itself half empty.
 */
export function LogActivity({
  types, templates, personId, companyId, jobId, candidateId, dealId,
}: {
  types: ActivityType[];
  templates?: { id: string; name: string; body: string }[];
  personId?: string;
  companyId?: string;
  jobId?: string;
  candidateId?: string;
  dealId?: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(types[0]?.slug ?? "note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const type = types.find((t) => t.slug === slug);
  const wantsOutcome = type?.category === "call";

  function submit() {
    if (!subject.trim() && !body.trim()) return;
    setError(null);
    start(async () => {
      try {
        await logActivity({
          typeSlug: slug,
          subject: subject.trim() || null,
          body: body.trim() || null,
          outcome: outcome.trim() || null,
          direction: type?.category === "email" ? (slug === "email-in" ? "inbound" : "outbound") : null,
          person_id: personId, company_id: companyId, job_id: jobId,
          candidate_id: candidateId, deal_id: dealId,
        });
        setSubject(""); setBody(""); setOutcome(""); setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not log that");
      }
    });
  }

  if (!open) {
    return (
      <div className="border-b p-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`w-full px-3 py-2 text-left text-sm text-muted-foreground ${FIELD}`}
        >
          Log a call, note or email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-b p-3">
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        >
          {types.map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>

        {templates?.length ? (
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value);
              if (t) { setBody(t.body); setSubject((s) => s || t.name); }
            }}
          >
            <option value="">Template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : null}

        {wantsOutcome && (
          <input
            className={`px-2 py-1.5 text-sm ${FIELD}`}
            placeholder="Outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
        )}
      </div>

      <input
        className={`w-full px-3 py-2 text-sm ${FIELD}`}
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        autoFocus
      />
      <textarea
        className={`min-h-24 w-full px-3 py-2 text-sm ${FIELD}`}
        placeholder="Notes"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending || (!subject.trim() && !body.trim())}>
          {pending ? "Saving…" : "Log"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
