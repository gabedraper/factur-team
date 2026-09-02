"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getMessageBody, type ConversationEntry } from "@/actions/conversation";
import { editClientNote, setNotePinned, deleteClientNote } from "@/actions/client-notes";
import { Mail, MessageSquare, Phone, Video, FileText, CircleDollarSign, AlertTriangle, MailWarning, StickyNote, Pin } from "lucide-react";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** A message happened at a moment, so it is shown in company time. */
function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/**
 * An invoice is recorded against a day, not a moment.
 *
 * Parsed piece by piece rather than through Date, because `new Date("2026-01-09")`
 * is midnight UTC and displaying that in Central moved every invoice back to
 * six o'clock the evening before.
 */
function onDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/** What kind of contact this was, so the line can be read at a glance. */
function Icon({ entry }: { entry: ConversationEntry }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (entry.kind === "invoice") return <FileText className={cls} />;
  if (entry.kind === "payment") return <CircleDollarSign className={cls} />;
  if (entry.kind === "gap") return <AlertTriangle className={cls} />;
  if (entry.kind === "note") return <StickyNote className={cls} />;
  if (entry.kind === "collections" || entry.kind === "collections_upcoming")
    return <MailWarning className={cls} />;
  if (entry.source === "google_chat") return <MessageSquare className={cls} />;
  if (entry.source === "meet_transcript") return <Video className={cls} />;
  // A logged call rather than an email; Salesforce records those as activities.
  if (entry.title?.toLowerCase().startsWith("call")) return <Phone className={cls} />;
  return <Mail className={cls} />;
}

/** The month an invoice covers, taken from its date -- see get_client_conversation. */
function monthName(date: string) {
  const [y, m] = date.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

/** The three routes differ in how much they can be trusted; the weakest says so. */
function MatchNote({ by }: { by: ConversationEntry["matched_by"] }) {
  if (by !== "name") return null;
  return (
    <span
      className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200"
      title="Attached because the client's name appears in the subject, not because the client was on the message."
    >
      name match
    </span>
  );
}

/**
 * A client's money conversation.
 *
 * Client on the left, us on the right, and the internal discussion inset in the
 * middle -- it is about the client rather than to them, so it belongs to
 * neither side. Invoices and payments sit centred as markers, which is what
 * turns the list into a story: raised, chased, silence, chased, paid.
 */
export function Conversation({
  entries, clientId,
}: {
  entries: ConversationEntry[];
  clientId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteProblem, setNoteProblem] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState<{ text: string | null; problem: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(e: ConversationEntry) {
    if (e.kind !== "message" || !e.external_id) return;
    if (open === e.external_id) {
      setOpen(null);
      return;
    }
    setOpen(e.external_id);
    setBody(null);
    startTransition(async () => {
      const r = await getMessageBody(e.external_id as string);
      setBody({ text: r.body, problem: r.problem });
    });
  }

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing recorded for this client yet.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map((e, i) => {
        const key = `${e.kind}-${e.external_id ?? i}`;

        if (e.kind === "gap") {
          return (
            <div key={key} className="flex justify-end">
              <div className="flex max-w-[80%] items-center gap-2 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-1.5 text-xs text-red-700 dark:border-red-800 dark:text-red-300">
                <Icon entry={e} />
                <span>
                  No invoice raised for{" "}
                  {e.service_month ? monthName(e.service_month) : "this month"}
                  {e.service_month && <> {e.service_month.slice(0, 4)}</>}
                </span>
              </div>
            </div>
          );
        }

        // A note somebody wrote here, inset like the rest of the internal talk.
        if (e.kind === "note") {
          const noteId = e.external_id;
          const isEditing = editing === noteId;

          /*
           * Rewriting keeps the note where it happened. Only the body changes,
           * so a typo fixed today does not drag a note from March to the top of
           * the trail.
           */
          const save = () => {
            if (!noteId || !noteDraft.trim()) return;
            setNoteProblem("");
            startTransition(async () => {
              const res = await editClientNote(clientId, noteId, noteDraft);
              if (!res.success) {
                setNoteProblem(res.error ?? "Couldn't save that.");
                return;
              }
              setEditing(null);
              router.refresh();
            });
          };

          const act = (fn: () => Promise<{ success: boolean; error?: string }>) => {
            setNoteProblem("");
            startTransition(async () => {
              const res = await fn();
              if (!res.success) {
                setNoteProblem(res.error ?? "Couldn't do that.");
                return;
              }
              router.refresh();
            });
          };

          return (
            <div key={key} className="flex justify-center">
              <div className="w-[80%] rounded-lg border border-dashed bg-muted/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <Icon entry={e} />
                  <span className="font-medium text-foreground">{e.author}</span>
                  <span className="italic">note</span>
                  <span>{e.occurred_at ? when(e.occurred_at) : ""}</span>

                  {noteId && !isEditing && (
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditing(noteId);
                          setNoteDraft(e.preview ?? "");
                        }}
                        className="hover:text-foreground"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => act(() => setNotePinned(clientId, noteId, true))}
                        disabled={pending}
                        className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                      >
                        <Pin className="h-3 w-3" /> Pin
                      </button>
                      <button
                        onClick={() => act(() => deleteClientNote(clientId, noteId))}
                        disabled={pending}
                        className="hover:text-foreground disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-1 space-y-2">
                    <textarea
                      autoFocus
                      rows={3}
                      value={noteDraft}
                      onChange={(ev) => setNoteDraft(ev.target.value)}
                      className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditing(null)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={save}
                        disabled={pending || !noteDraft.trim()}
                        className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5 whitespace-pre-wrap text-sm">{e.preview}</div>
                )}

                {noteProblem && isEditing && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{noteProblem}</p>
                )}
              </div>
            </div>
          );
        }

        /*
         * A chase that has not happened yet, dated forward so it sits at the
         * top of the feed. Outlined rather than filled: the trail is a record
         * of what occurred, and this is the one thing on it that has not.
         */
        if (e.kind === "collections_upcoming") {
          const overdue = e.service === "due";
          return (
            <div key={key} className="flex justify-end">
              <div
                className={`flex max-w-[80%] items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-xs ${
                  overdue
                    ? "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                    : "text-muted-foreground"
                }`}
              >
                <Icon entry={e} />
                <span>
                  <span className="font-medium">{e.title}</span>
                  {e.preview && <> · {e.preview}</>}
                  {" · "}
                  {overdue ? "due now" : e.on_date ? onDay(e.on_date) : ""}
                </span>
              </div>
            </div>
          );
        }

        /*
         * A chase we placed, shown from our own record. It gives way to the
         * real email as soon as the ingest collects the sent copy, so a drafted
         * one that was never sent keeps saying so.
         */
        if (e.kind === "collections") {
          const drafted = e.service === "semi";
          return (
            <div key={key} className="flex justify-end">
              <div className="max-w-[80%] rounded-lg border border-dashed bg-primary/5 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <Icon entry={e} />
                  <span className="font-medium text-foreground">
                    {drafted ? "Chase drafted" : "Chase sent"}
                  </span>
                  <span>{e.occurred_at ? when(e.occurred_at) : ""}</span>
                  {e.bill_email && <span>to {e.bill_email}</span>}
                </div>
                <div className="mt-0.5 text-sm font-medium">{e.title}</div>
                {e.preview && (
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.preview}</div>
                )}
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer"
                     className="mt-1 inline-block text-xs underline">
                    Open in Gmail
                  </a>
                )}
              </div>
            </div>
          );
        }

        if (e.kind === "invoice" || e.kind === "payment") {
          // Aligned by who did it: we raise invoices, they send payments.
          const ours = e.side === "us";
          const isInvoice = e.kind === "invoice";
          const openHere = isInvoice && open === `inv-${e.external_id}`;

          return (
            <div key={key} className={`flex ${ours ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg border border-dashed ${
                  ours ? "bg-primary/5" : "bg-emerald-500/5"
                }`}
              >
                <button
                  onClick={() =>
                    isInvoice && setOpen(openHere ? null : `inv-${e.external_id}`)
                  }
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                    isInvoice ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <Icon entry={e} />
                  <span>
                    {isInvoice ? (
                      <>
                        <span className="font-medium text-foreground">
                          Invoice {e.invoice_no}
                        </span>
                        {e.amount !== null && <> for <b className="text-foreground">{money.format(e.amount)}</b></>}
                        {e.service_month && <> sent for {monthName(e.service_month)}&apos;s services</>}
                        {e.outstanding !== null && e.outstanding > 0 && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {" · "}{money.format(e.outstanding)} outstanding
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">Payment received</span>
                        {e.amount !== null && <> · <b className="text-foreground">{money.format(e.amount)}</b></>}
                      </>
                    )}
                    {e.preview && <span className="text-muted-foreground"> · {e.preview}</span>}
                    <span className="text-muted-foreground">
                      {" · "}{e.on_date ? onDay(e.on_date) : ""}
                    </span>
                  </span>
                </button>

                {/*
                  * The invoice itself, drawn from what QuickBooks gave us.
                  *
                  * Intuit's own invoice page sends x-frame-options: SAMEORIGIN,
                  * so it cannot be put in a frame here -- it would render blank.
                  * These are the same figures off the same record.
                  */}
                {openHere && (
                  <div className="border-t border-dashed px-3 py-2 text-xs">
                    <div className="mb-2 flex items-baseline justify-between gap-4">
                      <span className="text-sm font-semibold">Invoice {e.invoice_no}</span>
                      <span className="text-muted-foreground">
                        {e.on_date ? onDay(e.on_date) : ""}
                        {e.due_date && <> · due {onDay(e.due_date)}</>}
                      </span>
                    </div>

                    <table className="w-full">
                      <thead>
                        <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="py-1 font-medium">Item</th>
                          <th className="py-1 text-right font-medium">Unit</th>
                          <th className="py-1 text-right font-medium">Qty</th>
                          <th className="py-1 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="py-1 pr-2">
                            {e.service ?? "—"}
                            {e.line_description && (
                              <div className="text-muted-foreground">{e.line_description}</div>
                            )}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {e.unit_price !== null ? money.format(e.unit_price) : "—"}
                          </td>
                          <td className="py-1 text-right tabular-nums">{e.quantity ?? "—"}</td>
                          <td className="py-1 text-right tabular-nums">
                            {e.amount !== null ? money.format(e.amount) : "—"}
                          </td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr className="border-t">
                          <td colSpan={3} className="py-1 text-right text-muted-foreground">Total</td>
                          <td className="py-1 text-right font-semibold tabular-nums">
                            {e.amount !== null ? money.format(e.amount) : "—"}
                          </td>
                        </tr>
                        {e.outstanding !== null && (
                          <tr>
                            <td colSpan={3} className="py-1 text-right text-muted-foreground">Outstanding</td>
                            <td className={`py-1 text-right font-semibold tabular-nums ${
                              e.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : ""
                            }`}>
                              {money.format(e.outstanding)}
                            </td>
                          </tr>
                        )}
                      </tfoot>
                    </table>

                    {e.bill_email && (
                      <p className="mt-2 text-muted-foreground">Billed to {e.bill_email}</p>
                    )}
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer"
                         className="mt-2 inline-block underline">
                        Open in QuickBooks
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        }

        const mine = e.side === "us";
        const internal = e.side === "internal";
        const isOpen = open === e.external_id;

        return (
          <div
            key={key}
            className={`flex ${internal ? "justify-center" : mine ? "justify-end" : "justify-start"}`}
          >
            <button
              onClick={() => toggle(e)}
              className={`max-w-[80%] rounded-lg border px-3 py-2 text-left transition-colors ${
                internal
                  ? "border-dashed bg-muted/40 hover:bg-muted"
                  : mine
                    ? "bg-primary/10 hover:bg-primary/15"
                    : "bg-card hover:bg-muted"
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <Icon entry={e} />
                <span className="font-medium text-foreground">{e.author ?? "unknown"}</span>
                {internal && <span className="italic">internal</span>}
                <span>{e.occurred_at ? when(e.occurred_at) : ""}</span>
                <MatchNote by={e.matched_by} />
              </div>

              <div className="mt-0.5 text-sm font-medium">{e.title}</div>

              {!isOpen && e.preview && (
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.preview}</div>
              )}

              {isOpen && (
                <div className="mt-2 border-t pt-2">
                  {pending && !body && (
                    <p className="text-xs text-muted-foreground">Fetching the message…</p>
                  )}
                  {body?.problem && (
                    <p className="text-xs text-red-600 dark:text-red-400">{body.problem}</p>
                  )}
                  {body?.text && (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">
                      {body.text}
                    </pre>
                  )}
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(ev) => ev.stopPropagation()}
                      className="mt-2 inline-block text-xs underline"
                    >
                      Open in Gmail
                    </a>
                  )}
                </div>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
