"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  placeChase, pauseClient, draftToMe, setCollectionsStage,
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

/*
 * The header, the totals and every row share this. Laying each row out on its
 * own with flex-wrap let the columns drift by a few pixels per row, which on
 * seventy-eight rows reads as a broken table rather than a rounding difference.
 */
const COLS =
  "grid items-center gap-x-3 " +
  "grid-cols-[minmax(9rem,1fr)_6.5rem_repeat(6,minmax(5.5rem,6.5rem))_minmax(0,13rem)]";

/** One money cell. Zero stays grey: a colour should mean there is something there. */
function Cell({ amount, tone }: { amount: number; tone?: string }) {
  return (
    <div className={`text-right tabular-nums ${amount > 0 ? tone ?? "" : "text-muted-foreground"}`}>
      {money.format(amount)}
    </div>
  );
}

/**
 * Where a client stands, in one phrase.
 *
 * Current and Past Due follow from the ageing report and nobody keeps them up
 * to date by hand. Service Paused and Sent to Collections are decisions, and no
 * amount of reading invoices will reveal them -- so those two are set here and
 * cleared here, and clearing hands the row back to the money.
 */
const STAGE_TONE: Record<string, string> = {
  Current: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  "Past Due": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  "Service Paused": "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  "Sent to Collections": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

/*
 * Only the two a person decides. The automatic choice is a third option built
 * per row, because its label is whatever the balance currently says -- listing
 * it here as well produced two options sharing one value, and the browser
 * highlighted the wrong one.
 */
const SETTABLE = [
  { value: "service_paused", label: "Service Paused" },
  { value: "sent_to_collections", label: "Sent to Collections" },
] as const;

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

  /*
   * Fresh server data wins.
   *
   * This holds a copy so a click can show its result before the round trip
   * finishes -- but a copy taken at mount ignores every later render, so
   * router.refresh() fetched the new stage and the screen kept showing the old
   * one until somebody reloaded the page.
   */
  const [lastRows, setLastRows] = useState(rows);
  if (lastRows !== rows) {
    setLastRows(rows);
    setBoard(rows);
  }
  const [open, setOpen] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, { subject: string; body: string }>>({});
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const key = (r: BoardChase) => r.qb_customer_id;

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
        x.qb_customer_id === r.qb_customer_id
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
    // Only a matched client can be chased; the button is hidden either way.
    const clientId = r.client_id;
    if (!clientId) return;
    const { subject, body } = wording(r);
    setNote(null);
    startTransition(async () => {
      const res = await placeChase(clientId, r.step_id, subject, body);
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
    // Only a matched client can be chased; the button is hidden either way.
    const clientId = r.client_id;
    if (!clientId) return;
    const { subject, body } = wording(r);
    setNote(null);
    startTransition(async () => {
      const res = await draftToMe(clientId, r.step_id, subject, body);
      setNote(
        res.success
          ? { kind: "ok", text: `Test draft waiting in ${res.to}. ${r.client_name} is still due.` }
          : { kind: "bad", text: res.error ?? "It did not go." }
      );
    });
  }

  function stage(r: BoardChase, next: string) {
    const clientId = r.client_id;
    if (!clientId) return;
    const value = next === "" ? null : (next as "service_paused" | "sent_to_collections");
    setNote(null);
    const was = { stage: r.stage, manual: r.stage_is_manual };
    // Shown at once; the refresh behind it replaces this with the real answer.
    setBoard((b) =>
      b.map((x) =>
        x.qb_customer_id === r.qb_customer_id
          ? {
              ...x,
              stage:
                value === "service_paused" ? "Service Paused"
                : value === "sent_to_collections" ? "Sent to Collections"
                : Number(x.past_due_total ?? 0) > 0 ? "Past Due" : "Current",
              stage_is_manual: value !== null,
            }
          : x
      )
    );

    startTransition(async () => {
      const res = await setCollectionsStage(clientId, value);
      if (!res.success) {
        setNote({ kind: "bad", text: res.error ?? "Couldn't change that." });
        setBoard((b) =>
          b.map((x) =>
            x.qb_customer_id === r.qb_customer_id
              ? { ...x, stage: was.stage, stage_is_manual: was.manual }
              : x
          )
        );
        return;
      }
      router.refresh();
    });
  }

  function pause(r: BoardChase, on: boolean) {
    const clientId = r.client_id;
    if (!clientId) return;
    const until = on ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) : null;
    setNote(null);
    startTransition(async () => {
      const res = await pauseClient(clientId, until, on ? "Paused from the board" : "");
      if (!res.success) {
        setNote({ kind: "bad", text: res.error ?? "Couldn't change that." });
        return;
      }
      setBoard((b) =>
        b.map((x) => (x.qb_customer_id === r.qb_customer_id ? { ...x, paused_until: until } : x))
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
          <b>{board.filter((r) => Number(r.past_due_total ?? 0) > 0).length}</b> past due
          {" · "}
          <b>{board.length}</b> with a balance
          {dueNow > 0 && <> · <b>{dueNow}</b> due a chase</>}
        </span>
      </div>

      {/*
        * The totals lead rather than close. Forty-nine clients is a page and a
        * half of scrolling, and the first question anyone brings here is how
        * much is out and how old it is -- not who is fourth alphabetically.
        */}
      {board.length > 0 && (
        <div className="space-y-1">
          <div className={`${COLS} px-3 text-[10px] uppercase tracking-wide text-muted-foreground`}>
            <div>Client</div>
            <div>Stage</div>
            <div className="text-right">Current</div>
            <div className="text-right">1 – 30</div>
            <div className="text-right">31 – 60</div>
            <div className="text-right">61 – 90</div>
            <div className="text-right">91+</div>
            <div className="text-right">Past due</div>
            <div />
          </div>
          <div className={`${COLS} rounded-lg border bg-muted/40 px-3 py-2 text-sm`}>
            <div className="font-medium">Total</div>
            <div />
            <Cell amount={totals.current} tone={AGEING_TONE.current} />
            <Cell amount={totals.b1_30} tone={AGEING_TONE.b1_30} />
            <Cell amount={totals.b31_60} tone={AGEING_TONE.b31_60} />
            <Cell amount={totals.b61_90} tone={AGEING_TONE.b61_90} />
            <Cell amount={totals.b91_plus} tone={AGEING_TONE.b91_plus} />
            <Cell amount={totals.past_due} tone="font-semibold text-foreground" />
            <div />
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
        /*
         * In the sequence means a step is due or one is coming. Paused stops
         * it, and so does a ladder that has run out -- in both cases the button
         * offers to put them back rather than to stop something already stopped.
         */
        const inSequence = !paused && (due || r.next_step_on !== null);
        const w = wording(r);

        return (
          <div key={key(r)} className="rounded-lg border bg-card">
            <div className={`${COLS} px-3 py-2 text-sm`}>
              {/* Truncated rather than wrapped: a long name must not push the
                  money out of line with the row above it. */}
              <div className="min-w-0 truncate" title={r.client_name}>
                {r.client_id ? (
                  <Link href={`/clients/${r.client_id}`} className="font-medium hover:underline">
                    {r.client_name}
                  </Link>
                ) : (
                  <span className="font-medium">{r.client_name}</span>
                )}
                {r.matched && r.client_active === false && (
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    inactive client
                  </span>
                )}
                {!r.matched && (
                  <Link
                    href="/settings/quickbooks"
                    className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 hover:underline dark:bg-amber-950 dark:text-amber-200"
                  >
                    not matched to a client
                  </Link>
                )}
              </div>

              <div className="min-w-0">
                {visibility.can_act && r.matched ? (
                  <select
                    value={r.stage_is_manual
                      ? (r.stage === "Service Paused" ? "service_paused" : "sent_to_collections")
                      : ""}
                    onChange={(e) => stage(r, e.target.value)}
                    disabled={pending}
                    title={r.stage}
                    className={`w-full rounded-full px-2 py-0.5 text-[11px] ${STAGE_TONE[r.stage] ?? ""}`}
                  >
                    {/*
                      * Reads as the stage when the balance is deciding, and as
                      * the way back to it when somebody has overridden.
                      */}
                    <option value="">
                      {r.stage_is_manual ? "Follow the balance" : r.stage}
                    </option>
                    {SETTABLE.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${STAGE_TONE[r.stage] ?? ""}`}>
                    {r.stage}
                  </span>
                )}
              </div>

              <Cell amount={r.bucket_current} tone={AGEING_TONE.current} />
              <Cell amount={r.bucket_1_30} tone={AGEING_TONE.b1_30} />
              <Cell amount={r.bucket_31_60} tone={AGEING_TONE.b31_60} />
              <Cell amount={r.bucket_61_90} tone={AGEING_TONE.b61_90} />
              <Cell amount={r.bucket_91_plus} tone={AGEING_TONE.b91_plus} />
              <Cell amount={Number(r.past_due_total ?? 0)} tone="font-semibold text-foreground" />

              <div className="flex items-center justify-end gap-1">
                {visibility.can_act && r.matched && (
                  <>
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
                          title="Draft this to yourself instead of the client"
                        >
                          <FlaskConical className="h-3.5 w-3.5" />
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
                    <button
                      onClick={() => pause(r, inSequence)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 truncate rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                    >
                      {inSequence
                        ? <PauseCircle className="h-3.5 w-3.5 shrink-0" />
                        : <PlayCircle className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">
                        {inSequence ? "Pause Collection Sequence" : "Add to Collections Sequence"}
                      </span>
                    </button>
                  </>
                )}
              </div>
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
