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
  keywords: string | null;
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

/*
 * A client on the landing screen, with its target companies counted per stage.
 *
 * The counts arrive as a map rather than a column each so a rename or a new
 * band does not mean a migration; render TARGET_STAGES in order against it and
 * skip the ones that are absent.
 */
export type ClientRow = {
  client_id: string;
  client_name: string;
  client_active: boolean;
  client_status: string | null;
  team_lead_id: string | null;
  team_lead_name: string | null;
  account_manager_id: string | null;
  account_manager_name: string | null;
  held_by_id: string | null;
  held_by_name: string | null;
  stage_counts: Partial<Record<TargetStage, number>>;
  companies: number;
  open_companies: number;
};

/* rep sees clients; lead sees their reports then clients; admin sees team
 * lead, then account manager, then clients. */
export type PipelineScope = {
  level: "rep" | "lead" | "admin";
  member_id: string;
  member_name: string | null;
};

/*
 * Which of the two progress ladders this viewer reads, from org_roles.stage_field.
 *
 * A pursuit carries both: Prospecting Lead Status is the prospector's ladder and
 * stops mattering once the lead is handed over; Stage is the deal's, and means
 * nothing to somebody still chasing a first reply. The role says which, so the
 * screen stops asking its reader to work out which column is theirs.
 */
export type StageFields = { show_stage: boolean; show_lead_status: boolean };

export const BOTH_STAGE_FIELDS: StageFields = { show_stage: true, show_lead_status: true };

/*
 * A campaign membership at a company: who was on it, and what came of it.
 *
 * Fetched once per account rather than once per contact -- the panel groups by
 * contact_id itself, which beats a query per row on an account with thirty-six
 * people at it.
 */
export type CampaignMembership = {
  contact_id: string;
  campaign_id: string;
  name: string;
  type: string | null;
  start_date: string | null;
  status: string | null;
  has_responded: boolean;
};
