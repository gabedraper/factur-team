"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addSmsConsent, removeSmsConsent, sendCollectionsSms, type SmsTarget,
} from "@/actions/collections";

export function CollectionsSmsPanel({
  clientId, target,
}: {
  clientId: string;
  target: SmsTarget;
}) {
  const [consented, setConsented] = useState(target.consented);
  const [note, setNote] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  function recordConsent() {
    setError(null);
    start(async () => {
      const result = await addSmsConsent(clientId, note);
      if (!result.ok) { setError(result.error); return; }
      setConsented(true);
      setNote("");
    });
  }

  function revokeConsent() {
    setError(null);
    start(async () => {
      const result = await removeSmsConsent(clientId);
      if (!result.ok) { setError(result.error); return; }
      setConsented(false);
    });
  }

  function send() {
    if (!target.phone) return;
    setError(null);
    setSent(false);
    start(async () => {
      const result = await sendCollectionsSms(clientId, target.phone!, body);
      if (!result.ok) { setError(result.error); return; }
      setSent(true);
      setBody("");
      setTimeout(() => setSent(false), 3000);
    });
  }

  return (
    <div className="space-y-3 text-sm">
      {error && <p className="text-red-600">{error}</p>}

      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">Phone</span>
        <span className="tabular-nums">{target.phone ?? "—"}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">SMS consent</span>
        {consented ? (
          <Button size="sm" variant="outline" onClick={revokeConsent} disabled={pending}>
            Revoke
          </Button>
        ) : (
          <span className="text-muted-foreground">Not recorded</span>
        )}
      </div>

      {!consented && (
        <div className="space-y-2 rounded-md border p-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Where does this consent come from?"
          />
          <Button size="sm" onClick={recordConsent} disabled={pending || !note.trim()}>
            Record consent
          </Button>
        </div>
      )}

      {consented && (
        <div className="space-y-2 rounded-md border p-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message"
            rows={3}
          />
          <div className="flex items-center justify-end gap-2">
            {sent && <span className="mr-auto text-xs text-emerald-600">Sent.</span>}
            <Button size="sm" onClick={send} disabled={pending || !target.phone || !body.trim()}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
