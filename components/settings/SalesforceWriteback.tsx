"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/components/pipeline/bits";
import {
  setWritebackEnabled, addWritebackTester, removeWritebackTester, pushWritebackNow,
  type WritebackTester,
} from "@/actions/salesforce-writeback";

/*
 * The switch, who is in the test, and a way to push what is waiting.
 *
 * The switch is the thing to reach for if a push starts doing something
 * unexpected: off means the save action stops queueing and the sweep stops
 * sending, immediately, without a deploy.
 */

const SELECT =
  "h-9 rounded-md border border-input bg-field px-2 text-body ring-offset-background " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function SalesforceWritebackControls({
  enabled, testers, members,
}: {
  enabled: boolean;
  testers: WritebackTester[];
  members: { id: string; full_name: string | null; email: string }[];
}) {
  const [busy, start] = useTransition();
  const [pick, setPick] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const say = (res: { ok: true } | { ok: false; error: string }, done: string) => {
    if (res.ok) { setNote(done); setError(null); } else { setError(res.error); setNote(null); }
  };

  const untested = members.filter((m) => !testers.some((t) => t.member_id === m.id));

  return (
    <div className="space-y-3">
      <Surface>
        <div className="flex flex-wrap items-center gap-3">
          <Chip colour={enabled ? "emerald" : "slate"}>{enabled ? "On" : "Off"}</Chip>
          <span className="text-body">Pushing edits to Salesforce</span>
          <Button
            size="sm"
            variant={enabled ? "destructive" : "default"}
            disabled={busy}
            onClick={() => start(async () => say(await setWritebackEnabled(!enabled), enabled ? "Switched off." : "Switched on."))}
          >
            {enabled ? "Switch off" : "Switch on"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => start(async () => {
              const res = await pushWritebackNow();
              if (res.ok) { setNote(res.summary); setError(null); } else { setError(res.error); setNote(null); }
            })}
          >
            Push waiting edits
          </Button>
        </div>
      </Surface>

      <Surface>
        <div className="space-y-3">
          <h2 className="text-section-title">Whose edits are pushed</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={SELECT} aria-label="Person to add">
              <option value="">Choose a person…</option>
              {untested.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy || !pick}
              onClick={() => start(async () => { say(await addWritebackTester(pick), "Added."); setPick(""); })}
            >
              Add person
            </Button>
          </div>

          {testers.length === 0 ? (
            <p className="text-body text-muted-foreground">Nobody yet — no edits will be pushed.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {testers.map((t) => (
                <li key={t.member_id} className="flex items-center gap-2 rounded-full bg-card px-3 py-1 text-meta">
                  <span>{t.name}</span>
                  <button
                    type="button"
                    title={`Remove ${t.name}`}
                    disabled={busy}
                    onClick={() => start(async () => say(await removeWritebackTester(t.member_id), "Removed."))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Surface>

      {note && <p className="text-body text-muted-foreground">{note}</p>}
      {error && <p className="text-body text-destructive">{error}</p>}
    </div>
  );
}
