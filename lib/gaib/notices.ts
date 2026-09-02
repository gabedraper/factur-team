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
    .replace(/\s*\n+\s*/g, " — ")
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

  switch (n.toStatus) {
    /*
     * Nothing happened, and saying so is the whole point.
     *
     * A ticket that never reached the agent used to sit in the queue silently:
     * the person who reported it heard nothing and reasonably assumed somebody
     * was on it. Twice that went unnoticed for hours. An assistant that goes
     * quiet when it fails teaches people not to bother reporting things, which
     * costs far more than the bug did.
     */
    case "stuck":
      return `I have not managed to get started on ${thing} — something went wrong at my end, not with what you told me. Gabe has been told. Nothing for you to do. (Gaib ${n.ref})`;

    case "shipped":
      return n.kind === "bug"
        ? `That thing you flagged is fixed and live — ${thing}. Have a look next time you're on that screen, and tell me if it's still wrong. (Gaib ${n.ref})`
        : `Your idea is built and live — ${thing}. Give it a try and tell me if it's not what you had in mind. (Gaib ${n.ref})`;

    case "rejected": {
      const why = shorten(n.note);
      return [
        `Gabe's had a look at ${thing} and decided against it for now. (Gaib ${n.ref})`,
        why ? `His reasoning: ${why}` : null,
        `If you think that's the wrong call, tell me why and I'll put it back in front of him.`,
      ].filter(Boolean).join("\n\n");
    }

    case "duplicate":
      return `${thing} turned out to be the same thing somebody else had already reported, so it's been grouped with theirs. It's still being dealt with. (Gaib ${n.ref})`;

    /*
     * The one that needs the most care.
     *
     * "Failed" means the work stopped, which from the reporter's side is
     * usually because the description was not enough to go on -- and the useful
     * response to that is a question, not a status. Asking for the missing
     * piece is the whole reason to come back at all.
     */
    case "failed": {
      const why = shorten(n.note, 200);
      return [
        `I got stuck on ${thing} and could use a bit more from you. (Gaib ${n.ref})`,
        why ? `Where it went wrong: ${why}` : null,
        `If you can tell me exactly what you clicked and what you saw, I'll have another go.`,
      ].filter(Boolean).join("\n\n");
    }

    case "awaiting_review":
      return n.kind === "idea"
        ? [
            `I've worked out what ${thing} would involve, and it's with Gabe to decide. (Gaib ${n.ref})`,
            `I'll come back to you either way.`,
          ].join("\n\n")
        : [
            `The fix for ${thing} is written and waiting on Gabe to check it before it goes live. (Gaib ${n.ref})`,
            `I'll let you know when it's in.`,
          ].join("\n\n");

    default:
      return `There's an update on ${thing}. (Gaib ${n.ref})`;
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
    "I'll get this fixed now. It's a small one, so it should be sorted shortly — I'll come back and tell you when it's done.",
  bug_approval:
    "Gabe needs to sign this one off before anything changes, because it's near something we don't touch without a person looking. I'll let you know either way.",
  idea:
    "I'll work out what this would take and put it in front of Gabe. I'll come back to you whether he says yes or no.",
} as const;
