"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ExternalLink, GitPullRequest, MessageCircleQuestion, MessagesSquare } from "lucide-react";
import type { Ticket } from "@/lib/gaib/tickets";
import { approveTicket, rejectTicket, closeTicket, retryTicket, askAboutTicket, ticketConversation, mergeTicket, ticketChat } from "@/actions/gaib";

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

/**
 * How long ago it was reported, in the words somebody would use.
 *
 * Days rather than hours past the first day, and a plain date once it is old
 * enough that counting stops meaning anything -- "23 days ago" is arithmetic
 * where "12 Aug" is a fact.
 */
function submitted(when: string): string {
  const then = new Date(when);
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;

  const days = Math.floor(mins / (24 * 60));
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

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
  const [chat, setChat] = useState<
    { kind: string; who?: string; text?: string; ref?: number; title?: string }[] | null
  >(null);
  const [chatDenied, setChatDenied] = useState(false);
  const [thread, setThread] = useState<
    { id: string; question: string; answer: string | null;
      asked_at: string; answered_at: string | null; closed_at: string | null }[] | null
  >(null);
  const [error, setError] = useState("");
  /*
   * What just happened, when the card cannot show it by changing.
   *
   * Merging deliberately does not set the status -- the workflow that watches
   * for the merge does, so "shipped" means the code actually landed rather than
   * that a button was pressed. The gap is several seconds, during which the
   * card looked untouched and said nothing, so the honest reading was that the
   * press had not worked. Everybody pressed it twice, and the log shows two
   * merges on nearly every ticket.
   */
  const [done, setDone] = useState("");
  const [pending, start] = useTransition();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    said?: string
  ) {
    setError("");
    setDone("");
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't work");
      else if (said) setDone(said);
    });
  }

  return (
    /*
     * Addressable, so a link from the panel lands on the right card. The scroll
     * margin keeps it clear of the top of the window rather than jammed against
     * it, which otherwise looks like the page has failed to move.
     */
    <div id={`gaib-${ticket.ref}`} className="scroll-mt-6 rounded-lg border p-4">
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
            {/*
              When it was reported. A queue without dates reads as though
              everything arrived at once, and the thing most worth knowing
              about a ticket waiting on you is how long it has been waiting.
              The full date and time is on hover.
            */}
            <span
              className="text-xs text-muted-foreground"
              title={new Date(ticket.created_at).toLocaleString()}
            >
              {submitted(ticket.created_at)}
            </span>
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

          {/*
            What was actually said. A ticket is Gaib's summary of a conversation,
            and the summary is what gets decided on -- so the conversation itself
            has to be one click away, not a different screen.
          */}
          {chat === null ? (
            <button
              onClick={() =>
                void ticketChat(ticket.id).then((c) =>
                  c === null ? setChatDenied(true) : setChat(c)
                )
              }
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
            >
              <MessagesSquare className="h-3 w-3" />
              Show the conversation
            </button>
          ) : chat.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No conversation recorded — this one was raised another way.
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto rounded-md bg-muted/40 p-3">
              {/*
                Whose conversation this is, said once at the top. The bubbles on
                the right are theirs, not the reader's, and without a name that
                reads as your own chat with Gaib.
              */}
              <p className="pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {raisedByName ?? "They"} and Gaib
              </p>
              {chat.map((line, i) =>
                line.kind === "ticket" ? (
                  <p key={i} className="text-xs italic text-muted-foreground">
                    raised Ticket {line.ref}
                  </p>
                ) : (
                  <div
                    key={i}
                    className={
                      line.who === "you"
                        ? "ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground"
                        : "w-fit max-w-[85%] rounded-lg bg-background px-2.5 py-1.5 text-xs whitespace-pre-wrap"
                    }
                  >
                    {line.text}
                  </div>
                )
              )}
            </div>
          )}
          {chatDenied && (
            <p className="text-xs text-muted-foreground">
              Reading conversations needs the transcripts permission.
            </p>
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
          {/*
            The actions that build something, and the ones that close it, are
            two different groups because only the second kind takes a reason.
            One row of five buttons under a single Reason box read as though the
            box applied to all of them; it applied to Reject alone, and anything
            typed before pressing Duplicate was thrown away without a word.
          */}
          <div className="flex flex-wrap gap-2">
            {/*
              Three different things, not one button with three labels. A ticket
              with a finished pull request needs merging; one that has only been
              scoped needs building; one that has neither needs handing to the
              agent. Approve used to mean the last of those in all three cases,
              which threw away finished work on the first.
            */}
            {ticket.pr_url ? (
              <Button
                size="sm"
                // Stays disabled after it works. A merged pull request cannot be
                // merged again, and the second press was only ever asking for
                // reassurance the card should have given the first time.
                disabled={pending || done !== ""}
                onClick={() =>
                  run(() => mergeTicket(ticket.id), "Merged — shipped in a moment")
                }
              >
                {done ? "Merged" : "Merge and ship"}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={pending || done !== ""}
                onClick={() =>
                  run(() => approveTicket(ticket.id), "Sent to the agent")
                }
              >
                {ticket.kind === "idea" ? "Build it" : "Hand to the agent"}
              </Button>
            )}
            {ticket.status === "failed" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryTicket(ticket.id), "Sent back to the agent")}>
                Retry
              </Button>
            )}
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <Textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              rows={1}
              placeholder="Reason"
              className="resize-none text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending || done !== ""}
                onClick={() => run(() => rejectTicket(ticket.id, why), "Rejected")}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || done !== ""}
                onClick={() => run(() => closeTicket(ticket.id, "shipped", why), "Marked shipped")}
              >
                Mark shipped
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || done !== ""}
                onClick={() => run(() => closeTicket(ticket.id, "duplicate", why), "Marked duplicate")}
              >
                Duplicate
              </Button>
            </div>
          </div>

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

          {done && <p className="text-sm text-muted-foreground">{done}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
