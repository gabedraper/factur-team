/*
 * Telling somebody what happened to the thing they reported.
 *
 * Written here rather than generated, because these are the sentences most
 * likely to be read by somebody who does not work in software and has no reason
 * to. A model asked to phrase them would mostly get it right and occasionally
 * say "the PR is awaiting review", and the one time it does that is the time
 * somebody decides this thing is not for them.
 *
 * So: fixed strings, and a rule for every one of them. No pull request, no
 * repository, no deploy, no lane, no ticket status. Nothing the reader has to
 * already know. The reference number stays because people quote it back, and
 * "Gaib 12" needs no explanation.
 */

import { vary } from "./vary";

export type Notice = {
  id: string;
  ref: number;
  title: string;
  kind: "bug" | "idea";
  toStatus: string;
  note: string | null;
};

/** Trim the agent's write-up down to something worth reading in a chat bubble. */
function shorten(note: string | null, cap = 240): string | null {
  if (!note) return null;
  // Collapsed onto one line as well as stripped: the agent writes headings, and
  // a heading left on its own line reads as "His reasoning: Verdict" followed by
  // the actual reason underneath.
  const clean = note
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const cut = clean.slice(0, cap);
  return clean.length > cap ? `${cut.replace(/\s+\S*$/, "")}…` : cut;
}

/**
 * What Gaib says when it comes back to somebody.
 *
 * One short line of news, then the reason where there is one. Never an
 * apology-shaped opening -- "unfortunately" before the sentence that already
 * says no is padding a person has to read twice.
 */
export function phrase(n: Notice): string {
  const thing = `"${n.title}"`;
  const tag = `[Ticket ${n.ref}]`;

  /*
   * Several ways to say each one, in Gabe's voice, picked at random. The same
   * sentence for every update is the fastest way to make a person sound like
   * a machine, and these are the lines people see most.
   */
  switch (n.toStatus) {
    /*
     * Nothing happened, and saying so is the whole point.
     *
     * A ticket that never reached the agent used to sit in the queue silently:
     * the person who reported it heard nothing and reasonably assumed somebody
     * was on it. An assistant that goes quiet when it fails teaches people not
     * to bother reporting things, which costs far more than the bug did.
     */
    case "stuck":
      return vary("stuck", [
        `ok so i haven't managed to get going on ${thing}. that's on my end, not anything you said. Gabe knows. nothing for you to do ${tag}`,
        `heads up, ${thing} got stuck before i even started. my fault, not yours. Gabe's been told ${tag}`,
        `${thing} hit a snag on my side before i could start on it. you're good, nothing needed from you. Gabe's on it ${tag}`,
      ]);

    case "shipped": {
      const why = shorten(n.note);
      const line = n.kind === "bug"
        ? vary("shipped-bug", [
            `fixed. ${thing} is live. have a look next time you're on that screen and tell me if it's still weird ${tag}`,
            `${thing} is sorted and live. try now and let me know if anything's still off ${tag}`,
            `good news, ${thing} is fixed. give it a go and shout if it's not right ${tag}`,
            `done. ${thing} is fixed and live. try now ${tag}`,
          ])
        : vary("shipped-idea", [
            `your idea's built and live, ${thing}. give it a try and tell me if it's not what you had in mind ${tag}`,
            `${thing} is live! go poke at it and tell me what's missing ${tag}`,
            `built it. ${thing} is live now. give me feedback ${tag}`,
          ]);
      return [line, why ? `Gabe added: ${why}` : null].filter(Boolean).join("\n\n");
    }

    case "rejected": {
      const why = shorten(n.note);
      return [
        vary("rejected", [
          `Gabe looked at ${thing} and made the call not to do it for now ${tag}`,
          `update on ${thing}: Gabe decided against it for now ${tag}`,
          `${thing} is a no for now. Gabe's call ${tag}`,
        ]),
        why ? `His reasoning: ${why}` : null,
        vary("rejected-appeal", [
          `if you think that's the wrong call tell me why and i'll put it back in front of him`,
          `disagree? tell me why and i'll take it back to him`,
          `if you think he's wrong on this one, make the case and i'll pass it on`,
        ]),
      ].filter(Boolean).join("\n\n");
    }

    case "duplicate": {
      // Which ticket it was grouped with is the useful part, and it only
      // exists if somebody typed it.
      const why = shorten(n.note);
      return [
        vary("duplicate", [
          `turns out ${thing} is the same thing someone else already reported, so i've grouped it with theirs. still being worked on ${tag}`,
          `${thing} was already on the list from someone else, so they're together now. still moving ${tag}`,
          `someone beat you to ${thing}, it's grouped with theirs and still in progress ${tag}`,
        ]),
        why ? `Gabe added: ${why}` : null,
      ].filter(Boolean).join("\n\n");
    }

    /*
     * The one that needs the most care.
     *
     * "Failed" means the work stopped, which from the reporter's side is
     * usually because the description was not enough to go on -- and the useful
     * response to that is a question, not a status.
     */
    case "failed": {
      const why = shorten(n.note, 200);
      return [
        vary("failed", [
          `i got stuck on ${thing} and could use a bit more from you ${tag}`,
          `need your help on ${thing}, i hit a wall ${tag}`,
          `${thing} stumped me. can you give me a bit more to go on? ${tag}`,
        ]),
        why ? `Where it went wrong: ${why}` : null,
        vary("failed-ask", [
          `what exactly did you click, and what did you see?`,
          `tell me exactly what you clicked and what happened and i'll have another go`,
          `walk me through it. what did you click, what showed up?`,
        ]),
      ].filter(Boolean).join("\n\n");
    }

    case "awaiting_review":
      return n.kind === "idea"
        ? [
            vary("review-idea", [
              `i've worked out what ${thing} would take. it's with Gabe to decide ${tag}`,
              `scoped ${thing}, it's in front of Gabe now ${tag}`,
              `${thing} is mapped out and waiting on Gabe ${tag}`,
            ]),
            vary("review-idea-close", [`i'll come back to you either way`, `you'll hear from me either way`, `i'll let you know what he says`]),
          ].join("\n\n")
        : [
            vary("review-bug", [
              `the fix for ${thing} is written, just waiting on Gabe to check it before it goes live ${tag}`,
              `${thing} is fixed on my side, Gabe just has to sign it off ${tag}`,
              `got a fix for ${thing}. waiting on Gabe to give it the ok ${tag}`,
            ]),
            vary("review-bug-close", [`i'll tell you when it's in`, `i'll ping you once it's live`, `you'll hear from me when it ships`]),
          ].join("\n\n");

    default:
      return vary("other", [`there's an update on ${thing} ${tag}`, `quick update on ${thing} ${tag}`]);
  }
}

/**
 * What Gaib promises at the moment somebody reports something.
 *
 * Kept beside the updates above so the promise and the thing that keeps it stay
 * in step. If this ever says "within the hour" while the updates say nothing
 * for a week, it will be because these two lived in different files.
 */
export const WHAT_HAPPENS_NEXT = {
  bug_auto:
    "I'll get this fixed now. It's a small one, so it should be sorted shortly, and I'll come back and tell you when it's done.",
  bug_approval:
    "Gabe needs to sign this one off before anything changes, because it's near something we don't touch without a person looking. I'll let you know either way.",
  idea:
    "I'll build this now and Gabe gives it the ok before it goes live. I'll come back to you either way.",
} as const;
