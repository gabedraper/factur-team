/**
 * What a step does when it comes due.
 *
 * Modelled on Mixmax's stage actions, and deliberately including the ones this
 * app cannot yet perform. A dropdown that silently omits "Call recipient"
 * looks like a shorter product; one that offers it and cannot do it is worse.
 * They are listed, unavailable, and say what they are waiting on.
 *
 * The two email actions are the ones that work. They also make automatic and
 * manual a decision per step rather than per sequence, which is how a real
 * ladder is written -- an opener sent automatically, a final chase a person
 * reads before it goes.
 */

export type StepAction = {
  key: string;
  label: string;
  /** False while nothing behind it can carry the action out. */
  available: boolean;
  /** Why not, shown where the option is offered. */
  blocked?: string;
  /** Whether reaching this step sends something without a person involved. */
  automatic: boolean;
};

export const STEP_ACTIONS: StepAction[] = [
  {
    key: "email_auto",
    label: "Send email automatically",
    available: true,
    automatic: true,
  },
  {
    key: "email_manual",
    label: "Send email manually",
    available: true,
    automatic: false,
  },
  {
    key: "call",
    label: "Call recipient",
    available: false,
    blocked: "Needs a task queue",
    automatic: false,
  },
  {
    key: "sms",
    label: "Send manual SMS",
    available: false,
    blocked: "No SMS connection",
    automatic: false,
  },
  {
    key: "task",
    label: "Perform any task",
    available: false,
    blocked: "Needs a task queue",
    automatic: false,
  },
  {
    key: "linkedin_connect",
    label: "Send connection request",
    available: false,
    blocked: "No LinkedIn connection",
    automatic: false,
  },
  {
    key: "linkedin_inmail",
    label: "Send InMail",
    available: false,
    blocked: "No LinkedIn connection",
    automatic: false,
  },
];

export const DEFAULT_ACTION = "email_auto";

export function actionFor(key: string | null | undefined): StepAction {
  return STEP_ACTIONS.find((a) => a.key === key) ?? STEP_ACTIONS[0];
}

/**
 * What a step does, given the sequence it sits in.
 *
 * Steps written before actions existed carry no action of their own, so they
 * fall back to the sequence's own mode -- which is what decided this for every
 * step until now. Without the fallback, every existing step would silently
 * change behaviour the moment this shipped.
 */
export function resolveAction(
  stepAction: string | null | undefined,
  sequenceMode: "semi" | "full"
): StepAction {
  if (stepAction) return actionFor(stepAction);
  return actionFor(sequenceMode === "full" ? "email_auto" : "email_manual");
}
