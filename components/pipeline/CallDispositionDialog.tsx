"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { logOpportunityActivity } from "@/actions/pipeline";

const OUTCOMES = [
  "Connected — moved forward",
  "Connected — not interested",
  "Voicemail",
  "No answer",
  "Wrong number",
  "Callback requested",
] as const;

/**
 * Shared between every dial widget (Dialpad, Twilio, whatever comes next) --
 * the disposition write into opp_activities doesn't care which provider
 * placed the call, so this owns its own outcome/notes state rather than
 * making each widget duplicate it.
 */
export function CallDispositionDialog({
  open, onOpenChange, opportunityId, contactName, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  contactName: string;
  onSaved?: () => void;
}) {
  const [outcome, setOutcome] = useState<string>(OUTCOMES[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function save() {
    startSaving(async () => {
      const result = await logOpportunityActivity({
        opportunity_id: opportunityId,
        activity_type: "call",
        direction: "outbound",
        outcome,
        body: notes || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotes("");
      onOpenChange(false);
      onSaved?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How did the call with {contactName} go?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOutcome(o)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  outcome === o ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
          <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
