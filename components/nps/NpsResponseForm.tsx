"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { submitNpsResponse } from "@/actions/nps-response";

const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/*
 * Promoters are not asked whether they want a call.
 *
 * The live WordPress form routes 9s and 10s to a landing page that has no
 * follow-up question on it, and the export bears that out -- every response
 * above 8 has the field blank. Kept as it is: a client who just said they love
 * you does not need to be asked whether something is wrong.
 */
const FOLLOW_UP_CEILING = 8;

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
  initialFollowUp,
  prefillScore,
}: {
  token: string;
  initialScore: number | null;
  initialComment: string | null;
  initialFollowUp: boolean | null;
  prefillScore: number | null;
}) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [comment, setComment] = useState(initialComment ?? "");
  const [savedComment, setSavedComment] = useState(initialComment ?? "");
  const [followUp, setFollowUp] = useState<boolean | null>(initialFollowUp);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  /*
   * A score arriving in the URL is recorded here rather than on the server, so
   * that answering still takes a real browser. See the note in the page.
   */
  const prefillSent = useRef(false);
  useEffect(() => {
    if (prefillSent.current) return;
    if (prefillScore === null || initialScore !== null) return;
    prefillSent.current = true;
    setScore(prefillScore);
    void save(prefillScore, null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillScore, initialScore]);

  async function save(
    nextScore: number,
    nextComment: string | null,
    nextFollowUp: boolean | null
  ): Promise<boolean> {
    setPending(true);
    const res = await submitNpsResponse(token, nextScore, nextComment, nextFollowUp);
    setPending(false);
    if (!res.success) {
      setError(res.error ?? "That didn't save.");
      return false;
    }
    return true;
  }

  function choose(n: number) {
    setError("");
    const previous = score;
    setScore(n);
    startTransition(async () => {
      if (!(await save(n, null, null))) setScore(previous);
    });
  }

  function answerFollowUp(wants: boolean) {
    if (score === null) return;
    setError("");
    const previous = followUp;
    setFollowUp(wants);
    startTransition(async () => {
      if (!(await save(score, null, wants))) setFollowUp(previous);
    });
  }

  function saveComment() {
    if (score === null) return;
    setError("");
    startTransition(async () => {
      if (await save(score, comment, null)) setSavedComment(comment);
    });
  }

  const asksFollowUp = score !== null && score <= FOLLOW_UP_CEILING;

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
        <div className="space-y-6">
          <div className="space-y-3">
            <label htmlFor="nps-comment" className="block text-sm">
              What influenced your rating?
            </label>
            <textarea
              id="nps-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
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

          {asksFollowUp && (
            <div className="space-y-3">
              <p className="text-sm">
                Would you like a member of your Factur team to follow up with you?
              </p>
              <div className="flex gap-2">
                {[
                  { label: "Yes, please contact me", value: true },
                  { label: "No, not necessary", value: false },
                ].map((option) => (
                  <button
                    key={option.label}
                    onClick={() => answerFollowUp(option.value)}
                    aria-pressed={followUp === option.value}
                    disabled={pending}
                    className={`h-9 rounded-md border px-4 text-sm transition-colors disabled:opacity-50 ${
                      followUp === option.value
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "bg-card hover:bg-muted"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
