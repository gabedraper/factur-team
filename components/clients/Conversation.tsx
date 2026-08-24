"use client";

import { useState, useTransition } from "react";
import { getMessageBody, type ConversationEntry } from "@/actions/conversation";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
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

        if (e.kind === "event") {
          return (
            <div key={key} className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-xs text-muted-foreground">
                {e.title}
                {e.amount !== null && <> · <b className="text-foreground">{money.format(e.amount)}</b></>}
                {e.outstanding !== null && e.outstanding > 0 && <> · {money.format(e.outstanding)} outstanding</>}
                {e.preview && <> · {e.preview}</>}
                {" · "}{when(e.occurred_at)}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          );
        }

        const mine = e.direction === "outbound";
        const internal = e.direction === "internal";
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
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{e.author ?? "unknown"}</span>
                {internal && <span className="italic">internal</span>}
                <span>{when(e.occurred_at)}</span>
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
