"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Check, MessageSquare, MessageSquareOff } from "lucide-react";
import { openChatWith, type ChatReach } from "@/actions/gaib-admin";

/*
 * Who Gaib can reach in Google Chat, and the button that fixes the rest.
 *
 * The list is the point. Everybody with an unticked box is somebody whose
 * notifications have been going nowhere, which is invisible from every other
 * screen in the app.
 */
export function ChatReachPanel({ people }: { people: ChatReach[] }) {
  const closed = people.filter((p) => !p.open);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [said, setSaid] = useState("");
  const [failures, setFailures] = useState<{ name: string; why: string }[]>([]);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Google Chat</h2>
        <span className="text-xs text-muted-foreground">
          {people.length - closed.length} of {people.length} reachable
        </span>
      </div>

      {closed.length === 0 ? (
        <p className="text-sm text-muted-foreground">Everyone can be reached.</p>
      ) : (
        <>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {people.map((p) => (
              <label
                key={p.userId}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  p.open ? "text-muted-foreground" : "cursor-pointer hover:bg-accent"
                }`}
              >
                {p.open ? (
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0"
                      checked={picked.has(p.userId)}
                      disabled={pending}
                      onChange={() => toggle(p.userId)}
                    />
                    <MessageSquareOff className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  </>
                )}
                <span className="truncate">{p.name}</span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending || picked.size === 0}
              onClick={() =>
                start(async () => {
                  setSaid("");
                  setFailures([]);
                  const r = await openChatWith([...picked]);
                  if (!r.ok) return setSaid(r.error ?? "That didn't work");
                  setPicked(new Set());
                  setFailures(r.failures ?? []);
                  setSaid(
                    `Opened ${r.opened}, said hello to ${r.greeted}.` +
                      (r.failures?.length ? "" : " Reload to see the list update.")
                  );
                })
              }
            >
              {pending ? "Opening…" : `Start a conversation with ${picked.size || "…"}`}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              disabled={pending}
              onClick={() => setPicked(new Set(closed.map((p) => p.userId)))}
            >
              Select all {closed.length}
            </button>
          </div>
        </>
      )}

      {said && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Check className="mt-0.5 h-3 w-3 shrink-0" />
          {said}
        </p>
      )}
      {failures.map((f) => (
        <p key={f.name} className="text-xs text-destructive">
          {f.name}: {f.why}
        </p>
      ))}
    </div>
  );
}
