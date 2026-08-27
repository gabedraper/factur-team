// Kept out of actions/sequences.ts because a "use server" file may only export
// async functions, and a client component reading these would otherwise drag
// server-only code into the browser bundle.

export type Ending = "reply" | "nps_submitted" | "bill_paid" | "ladder_end" | "manual";

/*
 * What can stop a ladder, and what each means.
 *
 * Two of them the engine judges on its own: a reply is read off the mail trail,
 * and running out of steps is arithmetic. The other two are questions only the
 * process that owns the run can answer, so they are offered to that one alone.
 */
export const ENDINGS: { key: Ending; label: string; only?: string }[] = [
  { key: "reply", label: "They reply to the email" },
  { key: "nps_submitted", label: "They submit the survey", only: "nps" },
  { key: "bill_paid", label: "The balance is cleared", only: "collections" },
  { key: "ladder_end", label: "The last step is done" },
  { key: "manual", label: "Somebody stops it by hand" },
];
