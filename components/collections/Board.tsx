"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  placeChase, pauseClient, draftToMe,
  type BoardChase, type Settings, type Visibility,
} from "@/actions/collections";
import { FIELD } from "@/lib/field-class";
import { AGEING_TONE } from "@/lib/ageing-colours";
import { PauseCircle, PlayCircle, Send, FileText, FlaskConical } from "lucide-react";
import RichTextEditor from "@/components/rich-text-editor";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** A date the report gave us, shown without a timezone shifting it a day. */
function onDay(date: string | null) {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function onDayShort(date: string | null) {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function Bucket({ label, amount, tone }: { label: string; amount: number; tone?: string }) {
  return (
    <div className="min-w-16">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${amount > 0 ? tone ?? "" : "text-muted-foreground"}`}>
        {money.format(amount)}
      </div>
    </div>
  );
}

/**
 * Every client in arrears, in the order the ageing report lists them.
 *
 * The point of the page is the two dates under each name: what was last sent,
 * and when the next one lands. A client ninety days late who was chased on
 * Tuesday needs nothing today, and a queue of only today's work could not say
 * so.
 */
export function Board({
  rows, settings, visibility, scope,
}: {
  rows: BoardChase[];
  settings: Settings;
  visibility: Visibility;
  scope: "mine" | "all";
}) {
  const router = useRouter();
  const [board, setBoard] = useState(rows);
  const [open, setOpen] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, { subject: string; body: string }>>({});
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const key = (r: BoardChase) => r.client_id;

  function wording(r: BoardChase) {
    return (
      edited[key(r)] ?? {
        subject: r.rendered_subject ?? "",
        body: r.rendered_body ?? "",
      }
    );
  }

  function afterPlaced(r: BoardChase) {
    // The row stays -- they are still in arrears -- but the due step is spent.
    setBoard((b) =>
      b.map((x) =>
        x.client_id === r.client_id
          ? {
              ...x,
              step_id: null as unknown as string,
              rendered_subject: null,
              rendered_body: null,
              last_sent_at: new Date().toISOString(),
              last_step_position: r.step_position,
            }
          : x
      )
    );
    setOpen(null);
  }

  function place(r: BoardChase) {
    const { subject, body } = wording(r);
    setNote(null);
    startTransition(async () => {
      const res = await placeChase(r.client_id, r.step_id, subject, body);
      if (res.success) {
        afterPlaced(r);
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

  function test(r: BoardChase) {
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

  function pause(r: BoardChase, on: boolean) {
    const until = on ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) : null;
    setNote(null);
    startTransition(async () => {
      const res = await pauseClient(r.client_id, until, on ? "Paused from the board" : "");
      if (!res.success) {
        setNote({ kind: "bad", text: res.error ?? "Couldn't change that." });
        return;
      }
      setBoard((b) =>
        b.map((x) => (x.client_id === r.client_id ? { ...x, paused_until: until } : x))
      );
    });
  }

  const owed = board.reduce((n, r) => n + Number(r.past_due_total ?? 0), 0);
  const dueNow = board.filter((r) => r.step_id).length;

  // Summed over what is on screen, so switching to My clients re-totals to it.
  const sum = (pick: (r: BoardChase) => number) =>
    board.reduce((n, r) => n + Number(pick(r) ?? 0), 0);
  const totals = {
    current: sum((r) => r.bucket_current),
    b1_30: sum((r) => r.bucket_1_30),
    b31_60: sum((r) => r.bucket_31_60),
    b61_90: sum((r) => r.bucket_61_90),
    b91_plus: sum((r) => r.bucket_91_plus),
    past_due: owed,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {visibility.can_see_all && (
          <div className="flex items-center gap-1">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => router.push(`/collections?scope=${s}`)}
                className={`rounded-md border px-3 py-1 text-sm ${
                  scope === s ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {s === "mine" ? "My clients" : "All clients"}
              </button>
            ))}
          </div>
        )}
        <span className="text-sm">
          <b>{board.length}</b> past due
          {dueNow > 0 && <> · <b>{dueNow}</b> due a chase</>}
        </span>
      </div>

      {/*
        * The totals lead rather than close. Forty-nine clients is a page and a
        * half of scrolling, and the first question anyone brings here is how
        * much is out and how old it is -- not who is fourth alphabetically.
        */}
      {board.length > 0 && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Bucket label="Current" amount={totals.current} tone={AGEING_TONE.current} />
            <Bucket label="1 – 30" amount={totals.b1_30} tone={AGEING_TONE.b1_30} />
            <Bucket label="31 – 60" amount={totals.b31_60} tone={AGEING_TONE.b31_60} />
            <Bucket label="61 – 90" amount={totals.b61_90} tone={AGEING_TONE.b61_90} />
            <Bucket label="91+" amount={totals.b91_plus} tone={AGEING_TONE.b91_plus} />
            <Bucket label="Past due" amount={totals.past_due} tone="font-semibold" />
          </div>
        </div>
      )}

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

      {board.length === 0 && (
        <p className="text-sm text-muted-foreground">Nobody is past due.</p>
      )}

      {board.map((r) => {
        const isOpen = open === key(r);
        const paused = r.paused_until !== null && new Date(r.paused_until) >= new Date();
        const due = Boolean(r.step_id);
        const w = wording(r);

        return (
          <div key={key(r)} className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2 text-sm">
              <div className="min-w-56">
                <Link href={`/clients/${r.client_id}`} className="font-medium hover:underline">
                  {r.client_name}
                </Link>
                {!r.client_active && (
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    former client
                  </span>
                )}
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.last_sent_at
                    ? `Last: step ${r.last_step_position} on ${onDayShort(
                        r.last_sent_at.slice(0, 10)
                      )}`
                    : "Last: never chased"}
                  {" · "}
                  {due
                    ? `Next: step ${r.step_position} due now`
                    : r.next_step_on
                      ? `Next: step ${r.next_step_position} on ${onDayShort(r.next_step_on)}`
                      : "Next: sequence finished"}
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Bucket label="Current" amount={r.bucket_current} tone={AGEING_TONE.current} />
                <Bucket label="1 – 30" amount={r.bucket_1_30} tone={AGEING_TONE.b1_30} />
                <Bucket label="31 – 60" amount={r.bucket_31_60} tone={AGEING_TONE.b31_60} />
                <Bucket label="61 – 90" amount={r.bucket_61_90} tone={AGEING_TONE.b61_90} />
                <Bucket label="91+" amount={r.bucket_91_plus} tone={AGEING_TONE.b91_plus} />
                <Bucket label="Past due" amount={Number(r.past_due_total ?? 0)} tone="font-semibold" />
              </div>

              {paused && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  paused to {onDayShort(r.paused_until)}
                </span>
              )}

              {visibility.can_act && (
                <span className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => pause(r, !paused)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    {paused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                    {paused ? "Resume" : "Pause"}
                  </button>
                  {due && (
                    <>
                      <button
                        onClick={() => setOpen(isOpen ? null : key(r))}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        {isOpen ? "Hide" : "Read"}
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
                    </>
                  )}
                </span>
              )}
            </div>

            {due && !r.to_email && (
              <p className="border-t px-3 py-2 text-xs text-red-600 dark:text-red-400">
                No billing email on their QuickBooks record.
              </p>
            )}

            {isOpen && due && (
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
                  className={`${FIELD} w-full px-2 py-1 text-sm`}
                />
                <RichTextEditor
                  value={w.body}
                  onChange={(html) =>
                    setEdited((s) => ({ ...s, [key(r)]: { ...w, body: html } }))
                  }
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
