"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Ticket, X } from "lucide-react";
import { nudgeState, recordNudge, recordAnswered } from "@/actions/gaib";

type Line =
  | { kind: "said"; who: "you" | "gaib"; text: string }
  | { kind: "working"; text: string }
  | { kind: "ticket"; ref: number; title: string; lane: string }
  | { kind: "error"; text: string };

type Event =
  | { type: "session"; id: string }
  | { type: "text"; text: string }
  | { type: "working"; what: string }
  | { type: "ticket"; ref: number; title: string; lane: string }
  | { type: "error"; message: string }
  | { type: "done" };

const LANE_LABEL: Record<string, string> = {
  auto: "fixing now",
  approval: "for Gabe",
  scoping: "being scoped",
};

/** Three dots, so a pause reads as thinking rather than as nothing happening. */
function Typing() {
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-muted px-3 py-2.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

export function GaibWidget() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    nudgeState().then((s) => setAsking(s.ask ? s.opener : null));
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, thinking]);

  /*
   * Read the reply as it arrives.
   *
   * The stream is one JSON object per line, and a chunk can end mid-object, so
   * the tail is carried over rather than parsed. Parsing per chunk instead of
   * per line looks like it works right up until a reply is long enough to be
   * split, at which point it fails only for the longest answers.
   */
  const send = useCallback(
    async (text: string, openedBy: "user" | "gaib" = "user") => {
      setBusy(true);
      setThinking(true);
      if (text) setLines((l) => [...l, { kind: "said", who: "you", text }]);

      try {
        const res = await fetch("/api/gaib/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId, message: text, pageUrl: window.location.href, openedBy,
          }),
        });
        if (!res.ok || !res.body) throw new Error(await res.text());

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let tail = "";
        let streaming = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          tail += decoder.decode(value, { stream: true });
          const parts = tail.split("\n");
          tail = parts.pop() ?? "";

          for (const part of parts) {
            if (!part.trim()) continue;
            const event = JSON.parse(part) as Event;

            if (event.type === "session") setSessionId(event.id);
            else if (event.type === "text") {
              // Words are arriving, so the dots have done their job.
              setThinking(false);
              setLines((l) => {
                const last = l[l.length - 1];
                if (streaming && last?.kind === "said" && last.who === "gaib") {
                  return [...l.slice(0, -1), { ...last, text: last.text + event.text }];
                }
                streaming = true;
                return [...l, { kind: "said", who: "gaib", text: event.text }];
              });
            } else if (event.type === "working") {
              streaming = false;
              // Gaib went off to do something; there will be another pause
              // after it before any more words.
              setThinking(true);
              setLines((l) => [...l, { kind: "working", text: event.what }]);
            } else if (event.type === "ticket") {
              streaming = false;
              setThinking(true);
              setLines((l) => [
                ...l,
                { kind: "ticket", ref: event.ref, title: event.title, lane: event.lane },
              ]);
            } else if (event.type === "error") {
              setLines((l) => [...l, { kind: "error", text: event.message }]);
            }
          }
        }
      } catch (e) {
        setLines((l) => [
          ...l,
          { kind: "error", text: e instanceof Error ? e.message : "Gaib is not answering" },
        ]);
      } finally {
        setBusy(false);
        setThinking(false);
      }
    },
    [sessionId]
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || lines.length) return;

    if (asking) {
      // Gaib's own opening line is shown straight away rather than round-
      // tripping for it: the first thing you see on opening should already be
      // there, and the model has nothing to add to a question it was given.
      setLines([{ kind: "said", who: "gaib", text: asking }]);
      void recordNudge();
      setAsking(null);
    }
  }

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    if (!answered) {
      setAnswered(true);
      void recordAnswered();
    }
    void send(text);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        // Blurred on the way out. Otherwise the trigger keeps keyboard focus
        // behind the open panel, and the next Enter -- which the person means
        // as "send" -- activates the button again and shuts Gaib instead.
        onClick={(e) => {
          e.currentTarget.blur();
          toggle();
        }}
        className="w-full justify-start gap-2 text-muted-foreground"
      >
        <span className="relative flex">
          <MessageCircle className="h-4 w-4" />
          {asking && !open && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sky-500" />
          )}
        </span>
        Gaib
      </Button>

      {/*
        A panel in the corner rather than a dialog. Gaib is for talking about
        the thing you are looking at, and a modal covers the thing you are
        looking at -- people were describing a page they could no longer see.
        No overlay and no focus trap, so the app underneath stays usable while
        the conversation is open.
      */}
      {open && (
        <div
          role="complementary"
          aria-label="Gaib"
          className="fixed bottom-4 right-4 z-50 flex h-[30rem] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] flex-col rounded-xl border bg-background shadow-2xl sm:w-96"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <MessageCircle className="h-4 w-4" />
            <span className="text-sm font-medium">Gaib</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {lines.map((line, i) => {
              if (line.kind === "said") {
                return (
                  <div
                    key={i}
                    className={
                      line.who === "you"
                        ? "ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                        : "w-fit max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
                    }
                  >
                    {line.text}
                  </div>
                );
              }
              if (line.kind === "working") {
                return (
                  <p key={i} className="text-xs italic text-muted-foreground">
                    {line.text}…
                  </p>
                );
              }
              if (line.kind === "ticket") {
                return (
                  <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <Ticket className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">Gaib {line.ref}</span>
                    <span className="truncate text-muted-foreground">{line.title}</span>
                    <Badge variant="secondary" className="ml-auto shrink-0">
                      {LANE_LABEL[line.lane] ?? line.lane}
                    </Badge>
                  </div>
                );
              }
              return (
                <p key={i} className="text-sm text-destructive">
                  {line.text}
                </p>
              );
            })}
            {thinking && <Typing />}
            <div ref={bottom} />
          </div>

          <div className="flex items-end gap-2 border-t p-3">
            <Textarea
              ref={box}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") setOpen(false);
              }}
              rows={2}
              disabled={busy}
              // min-h-0 overrides the shared Textarea's 80px floor, which eats
              // a third of a panel this size.
              className="min-h-0 resize-none"
            />
            <Button size="icon" onClick={submit} disabled={busy || !draft.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
