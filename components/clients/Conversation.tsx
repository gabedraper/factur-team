"use client";

import { useState, useTransition } from "react";
import { getMessageBody, type ConversationEntry } from "@/actions/conversation";
import { Mail, MessageSquare, Phone, Video, FileText, CircleDollarSign, AlertTriangle } from "lucide-react";

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
export function Conversation({ entries }: { entries: ConversationEntry[] }) {
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

        if (e.kind === "invoice" || e.kind === "payment") {
          // Aligned by who did it: we raise invoices, they send payments.
          const ours = e.side === "us";
          return (
            <div key={key} className={`flex ${ours ? "justify-end" : "justify-start"}`}>
              <div
                className={`flex max-w-[80%] items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-xs ${
                  ours ? "bg-primary/5" : "bg-emerald-500/5"
                }`}
              >
                <Icon entry={e} />
                <span>
                  {e.kind === "invoice" ? (
                    <>
                      <span className="font-medium text-foreground">
                        Invoice {e.invoice_no}
                      </span>
                      {e.amount !== null && <> for <b className="text-foreground">{money.format(e.amount)}</b></>}
                      {e.service_month && <> sent for {monthName(e.service_month)}&apos;s services</>}
                      {e.service && <span className="text-muted-foreground"> · {e.service}</span>}
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
