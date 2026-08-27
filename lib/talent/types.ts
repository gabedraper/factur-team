/**
 * The shapes the talent screens pass around, and the labels they show.
 *
 * The database stores machine values (`contract_to_hire`, `strong_yes`) because
 * they are stable and can be checked; the labels live here so a screen never
 * invents its own wording for one. Every map is `as const` and read through
 * `label()`, which falls back to the raw value rather than rendering "undefined"
 * when a new option is added to a check constraint and forgotten here.
 */

export type Id = string;

export const JOB_STATUS = {
  draft: "Draft",
  active: "Active",
  on_hold: "On hold",
  filled: "Filled",
  closed: "Closed",
  cancelled: "Cancelled",
} as const;

export const JOB_KIND = {
  internal: "Internal hire",
  contingency: "Contingency",
  retained: "Retained",
  container: "Container",
  contract: "Contract",
  rpo: "RPO",
} as const;

export const EMPLOYMENT_TYPE = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  contract_to_hire: "Contract to hire",
  temporary: "Temporary",
  internship: "Internship",
} as const;

export const REMOTE = {
  onsite: "On site",
  hybrid: "Hybrid",
  remote: "Remote",
} as const;

export const SALARY_PERIOD = {
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
} as const;

export const CANDIDATE_STATUS = {
  active: "Active",
  on_hold: "On hold",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  hired: "Hired",
} as const;

export const CANDIDATE_SOURCE = {
  sourced: "Sourced",
  applied: "Applied",
  referral: "Referral",
  import: "Imported",
  ai_match: "AI match",
  inbound: "Inbound",
  agency: "Agency",
  rehire: "Rehire",
} as const;

export const STAGE_KIND = {
  sourced: "Sourced",
  contacted: "Contacted",
  responded: "Responded",
  screening: "Screening",
  submitted: "Submitted",
  interview: "Interview",
  offer: "Offer",
  placed: "Placed",
  rejected: "Rejected",
  other: "Other",
} as const;

export const COMPANY_KIND = {
  client: "Client",
  prospect: "Prospect",
  target: "Target",
  vendor: "Vendor",
  internal: "Internal",
} as const;

export const PERSON_TYPE = {
  candidate: "Candidate",
  contact: "Contact",
  hiring_manager: "Hiring manager",
  referrer: "Referrer",
  employee: "Employee",
} as const;

export const PLACEMENT_STATUS = {
  pending: "Pending",
  active: "Active",
  completed: "Completed",
  fell_off: "Fell off",
  cancelled: "Cancelled",
} as const;

export const INVOICE_STATUS = {
  not_invoiced: "Not invoiced",
  invoiced: "Invoiced",
  paid: "Paid",
  written_off: "Written off",
} as const;

export const DEAL_STAGE = {
  new: "New",
  qualifying: "Qualifying",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
} as const;

export const RECOMMENDATION = {
  strong_yes: "Strong yes",
  yes: "Yes",
  neutral: "Neutral",
  no: "No",
  strong_no: "Strong no",
} as const;

export const INTERVIEW_KIND = {
  phone_screen: "Phone screen",
  interview: "Interview",
  client_interview: "Client interview",
  final_interview: "Final interview",
  meeting: "Meeting",
  debrief: "Debrief",
} as const;

export const SUBMISSION_STATUS = {
  draft: "Draft",
  shared: "Shared",
  viewed: "Viewed",
  feedback: "Feedback left",
  advanced: "Advanced",
  declined: "Declined",
} as const;

export const CAMPAIGN_CHANNEL = {
  email: "Email",
  sms: "Text message",
  call: "Call",
  linkedin: "LinkedIn",
  task: "Task",
} as const;

export const AUTOMATION_ACTION = {
  send_email: "Send an email",
  enrol_campaign: "Enrol in a campaign",
  create_task: "Create a task",
  notify_member: "Notify someone",
  request_scorecard: "Request a scorecard",
  schedule_interview: "Schedule an interview",
  draft_submission: "Draft a submission",
} as const;

/** Reads a label from one of the maps above, falling back to the raw value. */
export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "—";
  return map[value] ?? value;
}

/**
 * The colour names stages and tags are stored as, mapped to the classes that
 * draw them. Tailwind only emits a class it has literally seen, so these have
 * to be written out in full rather than built as `bg-${colour}-100`.
 */
export const TONE: Record<string, { chip: string; bar: string; dot: string }> = {
  slate:   { chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200", bar: "bg-slate-400", dot: "bg-slate-400" },
  sky:     { chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200", bar: "bg-sky-400", dot: "bg-sky-400" },
  cyan:    { chip: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200", bar: "bg-cyan-400", dot: "bg-cyan-400" },
  indigo:  { chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200", bar: "bg-indigo-400", dot: "bg-indigo-400" },
  violet:  { chip: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200", bar: "bg-violet-400", dot: "bg-violet-400" },
  amber:   { chip: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200", bar: "bg-amber-400", dot: "bg-amber-400" },
  orange:  { chip: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200", bar: "bg-orange-400", dot: "bg-orange-400" },
  emerald: { chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", bar: "bg-emerald-400", dot: "bg-emerald-400" },
  rose:    { chip: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200", bar: "bg-rose-400", dot: "bg-rose-400" },
};

export function tone(colour: string | null | undefined) {
  return TONE[colour ?? "slate"] ?? TONE.slate;
}

export const STAGE_COLOURS = Object.keys(TONE);

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** One entry in a person's `emails` or `phones` array. */
export type Contact = { value: string; type?: string; primary?: boolean };

export type Person = {
  id: Id;
  first_name: string | null;
  last_name: string | null;
  name: string;
  title: string | null;
  company_id: Id | null;
  company_name: string | null;
  emails: Contact[];
  phones: Contact[];
  primary_email: string | null;
  primary_phone: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  personal_website: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  person_types: string[];
  skills: string[];
  summary: string | null;
  resume_text: string | null;
  seniority: string | null;
  years_experience: number | null;
  current_salary: number | null;
  salary_expectation: number | null;
  compensation_notes: string | null;
  readiness_score: number | null;
  source: string;
  source_detail: string | null;
  do_not_contact: boolean;
  owner_member_id: Id | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  merged_into_id: Id | null;
};

export type PersonSummary = {
  id: Id;
  name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company_id: Id | null;
  company: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  person_types: string[];
  skills: string[];
  readiness_score: number | null;
  do_not_contact: boolean;
  source: string;
  owner_member_id: Id | null;
  owner_name: string | null;
  created_at: string;
  last_activity_at: string | null;
  linkedin_url: string | null;
  pipeline_count: number;
  active_pipeline_count: number;
  activity_count: number;
  resume_count: number;
};

export type Company = {
  id: Id;
  name: string;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  description: string | null;
  industry: string | null;
  headcount_label: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  kind: string;
  status: string;
  org_client_id: Id | null;
  owner_member_id: Id | null;
  created_at: string;
  last_activity_at: string | null;
};

export type WorkflowStage = {
  id: Id;
  workflow_id: Id;
  name: string;
  kind: string;
  position: number;
  color: string;
  is_terminal: boolean;
  counts_as_progression: boolean;
};

export type Workflow = {
  id: Id;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  active: boolean;
};

export type Job = {
  id: Id;
  title: string;
  company_id: Id | null;
  workflow_id: Id | null;
  status: string;
  job_kind: string;
  employment_type: string;
  confidential: boolean;
  description: string | null;
  requirements: string | null;
  internal_notes: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  remote: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: string;
  fee_type: string | null;
  fee_percent: number | null;
  fee_flat: number | null;
  openings: number;
  owner_member_id: Id | null;
  hiring_manager_person_id: Id | null;
  published: boolean;
  published_at: string | null;
  public_slug: string | null;
  opened_on: string | null;
  target_fill_on: string | null;
  closed_at: string | null;
  created_at: string;
  last_activity_at: string | null;
};

export type JobSummary = {
  id: Id;
  title: string;
  status: string;
  job_kind: string;
  employment_type: string;
  confidential: boolean;
  remote: string;
  city: string | null;
  state: string | null;
  openings: number;
  published: boolean;
  public_slug: string | null;
  opened_on: string | null;
  target_fill_on: string | null;
  salary_min: number | null;
  salary_max: number | null;
  created_at: string;
  last_activity_at: string | null;
  workflow_id: Id | null;
  company_id: Id | null;
  company_name: string | null;
  owner_member_id: Id | null;
  owner_name: string | null;
  active_count: number;
  total_count: number;
  submitted_count: number;
  interview_count: number;
  hired_count: number;
  last_candidate_activity: string | null;
};

export type PipelineRow = {
  candidate_id: Id;
  job_id: Id;
  job_title: string;
  confidential: boolean;
  company_name: string | null;
  person_id: Id;
  person_name: string;
  person_title: string | null;
  person_company: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  stage_id: Id | null;
  stage_name: string | null;
  stage_kind: string | null;
  stage_position: number | null;
  stage_color: string | null;
  status: string;
  rating: number | null;
  source: string;
  stage_changed_at: string;
  days_in_stage: number;
  last_activity_at: string | null;
  days_since_touch: number;
  owner_member_id: Id | null;
  owner_name: string | null;
  created_at: string;
};

export type ActivityType = {
  id: Id;
  name: string;
  slug: string;
  category: string;
  counts_as_progression: boolean;
  color: string;
  position: number;
  active: boolean;
};

export type Activity = {
  id: Id;
  activity_type_id: Id | null;
  person_id: Id | null;
  company_id: Id | null;
  job_id: Id | null;
  candidate_id: Id | null;
  deal_id: Id | null;
  subject: string | null;
  body: string | null;
  direction: string | null;
  outcome: string | null;
  pinned: boolean;
  occurred_at: string;
  created_by: Id | null;
  metadata: Record<string, unknown>;
};

export type Task = {
  id: Id;
  title: string;
  notes: string | null;
  due_at: string | null;
  priority: string;
  assigned_member_id: Id | null;
  person_id: Id | null;
  company_id: Id | null;
  job_id: Id | null;
  candidate_id: Id | null;
  deal_id: Id | null;
  done_at: string | null;
  created_at: string;
};

export type Integration = {
  slug: string;
  name: string;
  category: string;
  powers: string;
  status: "not_connected" | "connected" | "error" | "disabled";
  requires: string | null;
  config: Record<string, unknown>;
  last_error: string | null;
  connected_at: string | null;
};

export type TalentSettings = {
  agency_name: string;
  careers_page_enabled: boolean;
  careers_page_heading: string;
  careers_page_intro: string | null;
  careers_apply_email: string | null;
  default_workflow_id: Id | null;
  default_guarantee_days: number;
  outreach_mode: "semi" | "full";
  duplicate_check_on_add: boolean;
};

export type Member = { id: Id; full_name: string | null; email: string };
