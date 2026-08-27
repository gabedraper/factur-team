"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHOICES = [
  { key: "interview", label: "Interview" },
  { key: "interested", label: "Interested" },
  { key: "hold", label: "Hold" },
  { key: "declined", label: "Pass" },
] as const;

/**
 * What a hiring manager can say back.
 *
 * Four buttons and a box, because the thing that kills a submission is a client
 * who means to reply properly and therefore never replies at all. The token in
 * the URL is the whole authorisation -- the write goes through
 * `tal_portal_feedback`, which will not touch a submission on another job.
 */
export function PortalFeedback({
  token, submissionId, decision, feedback, canRespond,
}: {
  token: string;
  submissionId: string;
  decision: string | null;
  feedback: string | null;
  canRespond: boolean;
}) {
  const [choice, setChoice] = useState<string | null>(decision);
  const [note, setNote] = useState(feedback ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRespond) {
    return decision ? (
      <p className="text-sm text-muted-foreground">
        {CHOICES.find((c) => c.key === decision)?.label ?? decision}
        {feedback ? ` — ${feedback}` : ""}
      </p>
    ) : null;
  }

  async function send(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("tal_portal_feedback", {
        p_token: token,
        p_submission_id: submissionId,
        p_decision: next,
        p_feedback: note || null,
      });
      if (err) throw new Error(err.message);
      if (data === false) throw new Error("That link is no longer active");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={busy}
            onClick={() => { setChoice(c.key); setSaved(false); send(c.key); }}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              choice === c.key
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <textarea
        className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="Comments"
        value={note}
        onChange={(e) => { setNote(e.target.value); setSaved(false); }}
      />

      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => send(choice)}>
          {busy ? "Sending…" : "Send"}
        </Button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Sent</span>}
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
