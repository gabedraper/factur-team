"use client";

import { useState, useTransition } from "react";
import { submitNpsResponse } from "@/actions/nps-response";

const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * One client answering one question.
 *
 * The score saves on click, before the comment box even appears. Most people
 * who answer an NPS survey answer only the number and close the tab, and a
 * design that waits for a Submit throws those away -- which is most of them.
 */
export function NpsResponseForm({
  token,
  initialScore,
  initialComment,
}: {
  token: string;
  initialScore: number | null;
  initialComment: string | null;
}) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [comment, setComment] = useState(initialComment ?? "");
  const [savedComment, setSavedComment] = useState(initialComment ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function choose(n: number) {
    setError("");
    const previous = score;
    setScore(n);
    startTransition(async () => {
      const res = await submitNpsResponse(token, n, null);
      if (!res.success) {
        setScore(previous);
        setError(res.error ?? "That didn't save.");
      }
    });
  }

  function saveComment() {
    if (score === null) return;
    setError("");
    startTransition(async () => {
      const res = await submitNpsResponse(token, score, comment);
      if (!res.success) {
        setError(res.error ?? "That didn't save.");
        return;
      }
      setSavedComment(comment);
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <h1 className="text-xl font-medium leading-snug sm:text-2xl">
        How likely are you to recommend Factur to a friend or colleague?
      </h1>

      <div className="space-y-2">
        <div className="grid grid-cols-11 gap-1.5">
          {SCALE.map((n) => (
            <button
              key={n}
              onClick={() => choose(n)}
              aria-pressed={score === n}
              aria-label={String(n)}
              className={`flex h-11 items-center justify-center rounded-md border text-sm tabular-nums transition-colors sm:h-14 sm:text-base ${
                score === n
                  ? "border-transparent bg-primary font-semibold text-primary-foreground"
                  : "bg-card hover:bg-muted"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Not at all likely</span>
          <span>Extremely likely</span>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {score !== null && (
        <div className="space-y-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder="What's behind that score?"
            className="block w-full rounded-md border bg-field px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={saveComment}
              disabled={pending || comment === savedComment}
              className="h-9 rounded-md border px-4 text-sm disabled:opacity-50"
            >
              Send
            </button>
            {comment === savedComment && (
              <span className="text-sm text-muted-foreground">Thank you.</span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
