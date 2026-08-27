"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MessageCircle, Send, Ticket } from "lucide-react";
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

export function GaibWidget() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    nudgeState().then((s) => setAsking(s.ask ? s.opener : null));
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

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
              setLines((l) => [...l, { kind: "working", text: event.what }]);
            } else if (event.type === "ticket") {
              streaming = false;
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
      }
    },
    [sessionId]
  );

  function start(next: boolean) {
    setOpen(next);
    if (!next) return;
    if (lines.length) return;

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
    <Dialog open={open} onOpenChange={start}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground">
          <span className="relative flex">
            <MessageCircle className="h-4 w-4" />
            {asking && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sky-500" />
            )}
          </span>
          Gaib
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Gaib
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[55vh] min-h-[10rem] space-y-3 overflow-y-auto pr-1">
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
                <p key={i} className="text-xs text-muted-foreground italic">
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
          <div ref={bottom} />
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            autoFocus
            disabled={busy}
            className="resize-none"
          />
          <Button size="icon" onClick={submit} disabled={busy || !draft.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
