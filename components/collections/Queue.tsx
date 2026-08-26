"use client";

import { useState, useTransition } from "react";
import { placeChase, pauseClient, draftToMe, type Chase, type Settings } from "@/actions/collections";
import { PauseCircle, PlayCircle, Send, FileText, FlaskConical } from "lucide-react";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

function onDay(date: string | null) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/**
 * Everyone due a chase, worst first.
 *
 * The wording can be edited here before it goes. The address cannot: it comes
 * from the last invoice QuickBooks sent them and is decided on the server, so
 * this screen can chase a customer but cannot email anybody else.
 */
export function Queue({ rows, settings }: { rows: Chase[]; settings: Settings }) {
  const [queue, setQueue] = useState(rows);
  const [open, setOpen] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, { subject: string; body: string }>>({});
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const key = (r: Chase) => `${r.client_id}:${r.step_id}`;

  function wording(r: Chase) {
    return edited[key(r)] ?? { subject: r.rendered_subject, body: r.rendered_body };
  }

  function place(r: Chase) {
    const { subject, body } = wording(r);
    setNote(null);
    startTransition(async () => {
      const res = await placeChase(r.client_id, r.step_id, subject, body);
      if (res.success) {
        setQueue((q) => q.filter((x) => key(x) !== key(r)));
        setOpen(null);
        setNote({
          kind: "ok",
          text:
            res.mode === "full"
              ? `Sent to ${r.to_email}.`
              : `Draft waiting in ${settings.send_as} for ${r.client_name}.`,
        });
      } else {
        setNote({ kind: "bad", text: res.error ?? "It did not go." });
      }
    });
  }

  function test(r: Chase) {
    const { subject, body } = wording(r);
    setNote(null);
    startTransition(async () => {
      const res = await draftToMe(r.client_id, r.step_id, subject, body);
      setNote(
        res.success
          ? { kind: "ok", text: `Test draft waiting in ${res.to}. ${r.client_name} is still due.` }
          : { kind: "bad", text: res.error ?? "It did not go." }
      );
    });
  }

  function pause(r: Chase, on: boolean) {
    const until = on
      ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
      : null;
    setNote(null);
    startTransition(async () => {
      const res = await pauseClient(r.client_id, until, on ? "Paused from the queue" : "");
      if (!res.success) {
        setNote({ kind: "bad", text: res.error ?? "Couldn't change that." });
        return;
      }
      setQueue((q) =>
        q.map((x) =>
          x.client_id === r.client_id ? { ...x, paused_until: until, paused_reason: null } : x
        )
      );
    });
  }

  if (queue.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody is due a chase today.</p>;
  }

  const owed = queue.reduce((n, r) => n + Number(r.past_due_total ?? 0), 0);

  return (
    <div className="space-y-3">
      {note && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            note.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {note.text}
        </p>
      )}

      <p className="text-sm">
        <b>{queue.length}</b> due · <b>{money.format(owed)}</b> past due
      </p>

      {queue.map((r) => {
        const isOpen = open === key(r);
        const paused = r.paused_until !== null && new Date(r.paused_until) >= new Date();
        const w = wording(r);

        return (
          <div key={key(r)} className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <button
                onClick={() => setOpen(isOpen ? null : key(r))}
                className="font-medium hover:underline"
              >
                {r.client_name}
              </button>

              <span className="tabular-nums text-red-600 dark:text-red-400">
                {money.format(Number(r.past_due_total ?? 0))}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {r.days_past_due} days
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                Step {r.step_position} · day {r.step_days}
              </span>
              {r.last_sent_at && (
                <span className="text-xs text-muted-foreground">
                  last step {r.last_step_position} on{" "}
                  {new Date(r.last_sent_at).toLocaleDateString("en-US", {
                    day: "numeric", month: "short",
                  })}
                </span>
              )}
              {paused && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  paused to {onDay(r.paused_until)}
                </span>
              )}

              <span className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => pause(r, !paused)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {paused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                  {paused ? "Resume" : "Pause"}
                </button>
                <button
                  onClick={() => test(r)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  <FlaskConical className="h-3.5 w-3.5" /> Test to me
                </button>
                <button
                  onClick={() => place(r)}
                  disabled={pending || paused || !r.to_email}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {settings.mode === "full" ? <Send className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                  {settings.mode === "full" ? "Send" : "Draft"}
                </button>
              </span>
            </div>

            {!r.to_email && (
              <p className="border-t px-3 py-2 text-xs text-red-600 dark:text-red-400">
                No billing email on their QuickBooks record.
              </p>
            )}

            {isOpen && (
              <div className="space-y-2 border-t px-3 py-3">
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <div>To {r.to_email}</div>
                  <div>
                    {r.cc_emails ? (
                      <>Cc {r.cc_emails}</>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        No account manager or team lead to copy
                      </span>
                    )}
                  </div>
                  <div>Overdue since {onDay(r.overdue_since)}</div>
                </div>
                <input
                  value={w.subject}
                  onChange={(e) =>
                    setEdited((s) => ({ ...s, [key(r)]: { ...w, subject: e.target.value } }))
                  }
                  className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                />
                <textarea
                  value={w.body}
                  rows={14}
                  onChange={(e) =>
                    setEdited((s) => ({ ...s, [key(r)]: { ...w, body: e.target.value } }))
                  }
                  className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs leading-relaxed"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
