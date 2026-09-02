/**
 * The shape of a health score and how to read it. No server imports, so the
 * table component can use it -- lib/clients/health.ts opens a database
 * connection and a client component cannot reach into that.
 */

/**
 * One input's contribution to a client's health.
 *
 * `score` is null when there is nothing to measure -- never zero. A client with
 * no receivables on file is unmeasured, not unhealthy, and that difference has
 * to survive all the way to the screen or the best-paying clients read as
 * failing.
 */
export type HealthInput = {
  key: string;
  label: string;
  score: number | null;
  detail: string;
};

/** The A/R ageing as the report splits it, for the card that shows it. */
export type Ageing = {
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b91_plus: number;
};

export type ClientHealth = {
  clientId: string;
  name: string;
  status: string | null;
  accountManager: string | null;
  teamLead: string | null;
  manualHealth: string | null;
  overall: number | null;
  inputsMeasured: number;
  inputs: HealthInput[];
  /** Null where QuickBooks has no receivables record for them. */
  ageing: Ageing | null;
  collectionsStage: string | null;
};

/** Green above this, amber above the next, red below. */
export const HEALTHY = 70;
export const AT_RISK = 45;

export function band(score: number | null): "good" | "warning" | "critical" | "unknown" {
  if (score === null) return "unknown";
  if (score >= HEALTHY) return "good";
  if (score >= AT_RISK) return "warning";
  return "critical";
}
