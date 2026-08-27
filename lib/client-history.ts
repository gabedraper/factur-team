/**
 * What a slice of client history is, apart from the action that reads it.
 *
 * Its own file because a "use server" module may only export async functions --
 * a plain constant like HISTORY_FIELD_LABEL exported from
 * actions/client-history.ts fails the build. Same split as lib/client-contacts.ts.
 */

export type HistorySpan = {
  id: string;
  field: string;
  value: string | null;
  validFrom: string;
  validTo: string | null;
  source: string;
};

/** Field order here is the order the panel renders them in. */
export const HISTORY_FIELD_LABEL: Record<string, string> = {
  account_manager: "Account manager",
  team_lead: "Team lead",
  data_team_lead: "Data team lead",
  sdr: "SDR",
  marketing_strategist: "Marketing strategist",
  data_analyst: "Data analyst",
  data_engineer: "Data engineer",
  owner: "Covered by",
  service: "Service",
  status: "Status",
};
