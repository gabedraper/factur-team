"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ExternalLink, GitPullRequest, MessageCircleQuestion } from "lucide-react";
import type { Ticket } from "@/lib/gaib/tickets";
import { approveTicket, rejectTicket, closeTicket, retryTicket, askAboutTicket, ticketConversation } from "@/actions/gaib";

/*
 * What the severity words mean, said on the card.
 *
 * "annoying" on its own is a word, not a scale -- somebody reading the card has
 * no way to know whether it sits above or below "painful", or what either is
 * measuring. The label says what it cost the person, which is the thing being
 * ranked.
 */
const SEVERITY_MEANS: Record<string, string> = {
  blocking: "stopped them working",
  painful: "cost them real time",
  annoying: "irritating, not costly",
  cosmetic: "looks wrong, still works",
};

const SEVERITY: Record<string, string> = {
  blocking: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  painful: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  annoying: "bg-muted text-muted-foreground",
  cosmetic: "bg-muted text-muted-foreground",
};

const STATUS: Record<string, string> = {
  new: "New",
  queued: "Queued",
  running: "Running",
  awaiting_review: "Waiting on you",
  shipped: "Shipped",
  rejected: "Rejected",
  failed: "Failed",
  duplicate: "Duplicate",
};

export function TicketCard({
  ticket, raisedByName, decidable = false,
}: {
  ticket: Ticket;
  /** Who reported it. The first thing worth knowing before deciding anything. */
  raisedByName?: string | null;
  decidable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState(false);
  const [thread, setThread] = useState<
    { id: string; question: string; answer: string | null;
      asked_at: string; answered_at: string | null; closed_at: string | null }[] | null
  >(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't work");
    });
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-sm tabular-nums text-muted-foreground">
          {ticket.ref}
        </span>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-left text-sm font-medium hover:underline"
          >
            {ticket.title}
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {raisedByName && (
              <span className="text-xs font-medium text-muted-foreground">
                {raisedByName}
              </span>
            )}
            <Badge variant="outline">{ticket.kind}</Badge>
            <Badge className={SEVERITY[ticket.severity]} variant="secondary">
              {ticket.severity} — {SEVERITY_MEANS[ticket.severity] ?? ""}
            </Badge>
            <Badge variant="outline">{ticket.lane}</Badge>
            <span className="text-xs text-muted-foreground">
              {STATUS[ticket.status] ?? ticket.status}
            </span>
          </div>

          {/*
            The guard overruling Gaib is the one thing on this card that is
            always worth reading, so it is shown without opening anything.
          */}
          {ticket.guard_tripped && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {ticket.guard_tripped}
            </p>
          )}
        </div>

        {ticket.pr_url && (
          <a
            href={ticket.pr_url}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            PR
          </a>
        )}
        {ticket.run_url && (
          <a
            href={ticket.run_url}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Run
          </a>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t pt-4">
          <div className="whitespace-pre-wrap text-sm">{ticket.body}</div>

          {/*
            What has already been asked, so the same question is not put twice
            and an answer is read next to the request it explains.
          */}
          {thread === null ? (
            <button
              onClick={() => void ticketConversation(ticket.id).then(setThread)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Show questions
            </button>
          ) : thread.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing asked yet</p>
          ) : (
            <div className="space-y-2">
              {thread.map((q) => (
                <div key={q.id} className="rounded-md border-l-2 border-muted-foreground/30 pl-3">
                  <p className="text-sm">{q.question}</p>
                  {q.answer ? (
                    <p className="mt-1 text-sm text-muted-foreground">{q.answer}</p>
                  ) : (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      {q.closed_at ? "closed without an answer" : "waiting on them"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {ticket.page_url && (
            <a
              href={ticket.page_url}
              className="block truncate text-xs text-muted-foreground hover:underline"
            >
              {ticket.page_url}
            </a>
          )}

          {ticket.lane_reason && (
            <p className="text-xs text-muted-foreground">{ticket.lane_reason}</p>
          )}

          {ticket.brief && (
            <div className="rounded-md bg-muted p-3 whitespace-pre-wrap text-sm">
              {ticket.brief}
            </div>
          )}
        </div>
      )}

      {decidable && (
        <div className="mt-4 space-y-2 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => approveTicket(ticket.id))}>
              {ticket.kind === "idea" ? "Build it" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => rejectTicket(ticket.id, why))}
            >
              Reject
            </Button>
            {ticket.status === "failed" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryTicket(ticket.id))}>
                Retry
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => closeTicket(ticket.id, "shipped"))}
            >
              Mark shipped
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => closeTicket(ticket.id, "duplicate"))}
            >
              Duplicate
            </Button>
          </div>
          <Textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            rows={1}
            placeholder="Reason"
            className="resize-none text-sm"
          />

          {/*
            Asking is separate from deciding, and sits below it, because the
            usual reason to ask is that neither button is obviously right yet.
          */}
          <div className="flex items-start gap-2 pt-1">
            <Textarea
              value={question}
              onChange={(e) => { setQuestion(e.target.value); setAsked(false); }}
              rows={1}
              placeholder={`Ask ${raisedByName ?? "them"} something`}
              className="min-h-0 resize-none text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              disabled={pending || !question.trim()}
              onClick={() =>
                run(async () => {
                  const r = await askAboutTicket(ticket.id, question);
                  if (r.ok) { setQuestion(""); setAsked(true); setThread(null); }
                  return r;
                })
              }
            >
              <MessageCircleQuestion className="h-3.5 w-3.5" />
              Ask
            </Button>
          </div>
          {asked && (
            <p className="text-xs text-muted-foreground">
              Gaib will put that to them and bring the answer back here.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
