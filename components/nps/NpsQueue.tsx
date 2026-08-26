"use client";

import { useState, useTransition } from "react";
import {
  createNpsCampaign, draftSurveyToMe, placeSurvey,
  type Invitation, type Settings,
} from "@/actions/nps-sequence";

/**
 * Who is due a survey email, and the wording that would go out.
 *
 * One at a time, and editable before it goes. The queue is the server's answer
 * to "who is due what" -- the screen can change the words for one client, but
 * not who it goes to or who it comes from.
 */
export function NpsQueue({
  queue,
  settings,
  stepsActive,
}: {
  queue: Invitation[];
  settings: Settings;
  stepsActive: number;
}) {
  const [rows, setRows] = useState(queue);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(Math.floor(d.getMonth() / 3) * 3 + 1).padStart(2, "0")}-01`;
  });

  const key = (r: Invitation) => `${r.send_id}:${r.step_id}`;
  const draft = (r: Invitation) =>
    edits[key(r)] ?? { subject: r.rendered_subject, body: r.rendered_body };

  function edit(r: Invitation, patch: Partial<{ subject: string; body: string }>) {
    setEdits((e) => ({ ...e, [key(r)]: { ...draft(r), ...patch } }));
  }

  function build() {
    setError(""); setNote("");
    startTransition(async () => {
      const res = await createNpsCampaign(name, period);
      if (!res.success) { setError(res.error ?? "Couldn't build that."); return; }
      setNote(
        `${res.invitations} invitations created` +
        (res.skipped ? `, ${res.skipped} clients skipped` : "") +
        ". Nothing has been emailed."
      );
      setName("");
    });
  }

  function preview(r: Invitation) {
    setError(""); setNote("");
    startTransition(async () => {
      const res = await draftSurveyToMe(r.send_id, r.step_id);
      setNote(res.success ? "Draft is in your mailbox." : "");
      if (!res.success) setError(res.error ?? "Couldn't draft that.");
    });
  }

  function send(r: Invitation) {
    setError(""); setNote("");
    const d = draft(r);
    startTransition(async () => {
      const res = await placeSurvey(r.send_id, r.step_id, d.subject, d.body);
      if (!res.success) { setError(res.error ?? "Couldn't send that."); return; }
      setRows((rs) => rs.filter((x) => key(x) !== key(r)));
      setNote(
        res.mode === "full"
          ? `Sent to ${r.client_name}.`
          : `Drafted in ${r.from_name ?? r.from_email}'s mailbox.`
      );
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-4">
        <label className="text-xs text-muted-foreground">
          Campaign
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Q3 2026"
            className="mt-1 block h-8 w-48 rounded-md border bg-field px-2 text-sm"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Period
          <input
            type="date"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="mt-1 block h-8 rounded-md border bg-field px-2 text-sm"
          />
        </label>
        <button
          onClick={build}
          disabled={pending || !name.trim()}
          className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          Build invitations
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      {stepsActive === 0 && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Every step is switched off, so nothing is due. Turn one on in Settings → NPS.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const d = draft(r);
          const isOpen = open === key(r);
          return (
            <div key={key(r)} className="rounded-md border bg-card">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                <span className="rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
                  Step {r.step_position}
                </span>
                <span className="font-medium">{r.client_name}</span>
                <span className="text-sm text-muted-foreground">{r.to_email}</span>
                <span className="text-sm text-muted-foreground">
                  as {r.from_name ?? r.from_email}
                </span>
                {r.invited_at && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    day {r.days_since_send}
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => setOpen(isOpen ? null : key(r))}
                    className="h-8 rounded-md border px-3 text-sm"
                  >
                    {isOpen ? "Close" : "Review"}
                  </button>
                  <button
                    onClick={() => send(r)}
                    disabled={pending}
                    className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
                  >
                    {settings.mode === "full" ? "Send" : "Draft"}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="space-y-2 border-t px-4 py-3">
                  <input
                    value={d.subject}
                    onChange={(e) => edit(r, { subject: e.target.value })}
                    className="block h-8 w-full rounded-md border bg-field px-2 text-sm"
                  />
                  <textarea
                    value={d.body}
                    onChange={(e) => edit(r, { body: e.target.value })}
                    rows={12}
                    className="block w-full rounded-md border bg-field px-3 py-2 font-mono text-xs"
                  />
                  <button
                    onClick={() => preview(r)}
                    disabled={pending}
                    className="h-8 rounded-md border px-3 text-sm disabled:opacity-50"
                  >
                    Draft to me
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {rows.length === 0 && stepsActive > 0 && (
          <p className="text-sm text-muted-foreground">Nothing due.</p>
        )}
      </div>
    </div>
  );
}
