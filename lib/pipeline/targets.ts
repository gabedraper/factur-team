/*
 * The shape of a target account, kept out of the actions file.
 *
 * A "use server" module may only export async functions, so the stage list and
 * the row types live here and are imported by both the server actions and the
 * screens that render them.
 */

export type TargetStage =
  | "Cold Target" | "Engaging" | "Engaged" | "Long-Term Follow Up"
  | "Qualifying" | "Opportunity Found" | "Closing" | "Closed";

/*
 * In the order the work progresses, which is the order they appear as filters.
 *
 * Long-Term Follow Up is its own band rather than part of Qualifying, and that
 * matters: it is 29.5% of every opportunity -- 229,859 of them -- and it means a
 * deal that went quiet and is being nurtured, not one being actively qualified.
 * Folded together, a third of the pipeline would read as in play when it is
 * parked. It sits below Qualifying so an account with one live conversation and
 * ten dormant ones still reads as live.
 */
export const TARGET_STAGES: TargetStage[] = [
  "Cold Target", "Engaging", "Engaged", "Long-Term Follow Up",
  "Qualifying", "Opportunity Found", "Closing", "Closed",
];

/* Which colour a band wears, shared by the list and the panel so they agree. */
export const TARGET_STAGE_TONE: Record<TargetStage, "slate" | "amber" | "emerald" | "rose" | "blue"> = {
  "Cold Target": "slate",
  "Engaging": "slate",
  "Engaged": "blue",
  "Long-Term Follow Up": "amber",
  "Qualifying": "blue",
  "Opportunity Found": "emerald",
  "Closing": "emerald",
  "Closed": "rose",
};

export type TargetAccount = {
  account_id: string;
  account_name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  target_stage: TargetStage;
  stage_rank: number;
  contacts: number;
  open_contacts: number;
  next_action_date: string | null;
  last_activity_at: string | null;
  latest_update: string | null;
  total_count: number;
};

export type AccountContact = {
  opportunity_id: string;
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  target_stage: TargetStage;
  lead_status: string | null;
  next_action_date: string | null;
  updates: string | null;
  opened_on: string;
  last_activity_at: string | null;
  activity_count: number;
};

export type UnworkedContact = {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  other_clients_pursuing: number;
};
