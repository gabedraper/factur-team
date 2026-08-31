/*
 * Which models an agent may run on, and what each of them accepts.
 *
 * Not every model takes the same request. Effort -- how hard to think before
 * answering -- is understood by the current Opus and Sonnet models and rejected
 * outright by Haiku, which returns an error rather than ignoring it. The hub
 * offered Haiku as a choice and the chat loop sent effort on every request, so
 * choosing it would have produced an agent that failed on its first message
 * with something unhelpful about an invalid parameter.
 *
 * Capability lives here rather than being remembered at each call site, because
 * the next model added will differ again and there should be one place to say
 * how.
 */

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type ModelChoice = {
  id: string;
  label: string;
  /** What it is good for, in the hub, for somebody choosing between them. */
  note: string;
  /** Effort levels this model accepts. Empty means it does not take the setting. */
  efforts: EffortLevel[];
};

export const MODELS: ModelChoice[] = [
  {
    id: "claude-opus-5",
    label: "Opus 5",
    note: "Best judgement. Use for anything that reads people's words or decides something.",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    note: "Faster and cheaper, still capable. Fine for lookups and summaries.",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    note: "Cheapest and quickest. Only for narrow, mechanical jobs.",
    // Deliberately empty: this model errors if the setting is sent at all.
    efforts: [],
  },
];

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

/**
 * The effort to send, or null to leave the setting off entirely.
 *
 * Returns null both for a model that does not take the setting and for a model
 * nobody recognises -- an unknown id is more likely to be a typo or a model
 * retired since this was written than something that wants a tuning parameter,
 * and omitting it is the request most likely to still work.
 */
export function effortFor(model: string, wanted: string): EffortLevel | null {
  const choice = BY_ID.get(model);
  if (!choice || !choice.efforts.length) return null;
  return choice.efforts.includes(wanted as EffortLevel)
    ? (wanted as EffortLevel)
    // A level this model does not have falls back rather than failing. The
    // difference between xhigh and high is a matter of degree; the difference
    // between a reply and an error is not.
    : choice.efforts[choice.efforts.length - 1];
}

export function modelLabel(model: string): string {
  return BY_ID.get(model)?.label ?? model;
}
