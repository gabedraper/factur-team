/*
 * What a saved list view is allowed to contain.
 *
 * A view stores field keys and operator names, never SQL. Everything a view can
 * point at is in this file, so a filter arriving from the browser is either a
 * key that appears here or it is dropped -- there is no path from a saved view
 * to a query fragment. That is the whole reason the catalogue exists rather
 * than letting the UI name columns freely.
 *
 * Shared by both sides: the editor reads it to offer fields and operators, and
 * the server action reads it to build the query. One list, so the two cannot
 * disagree about what "Company" means or which operators a date accepts.
 */

export type FieldType = "text" | "date" | "picklist" | "boolean";

export type ListField = {
  key: string;
  label: string;
  type: FieldType;
  /* PostgREST path. Embedded fields are "table.column"; own columns are bare. */
  path: string;
  /* Rendered from more than one column -- the select needs all of them. */
  extraSelect?: string[];
  /* Which picklist the editor should offer as values, when it is one. */
  picklist?: "stage" | "lead_status";
};

/*
 * Contact and company first, because that is what a person scans for, then the
 * two progress fields, then dates, then the free text. Roughly Salesforce's own
 * column order on an Opportunity list, which is the point.
 */
export const LIST_FIELDS: ListField[] = [
  { key: "contact_name",     label: "Contact",        type: "text", path: "crm_contacts.last_name", extraSelect: ["crm_contacts.first_name"] },
  { key: "contact_title",    label: "Title",          type: "text", path: "crm_contacts.title" },
  { key: "contact_email",    label: "Email",          type: "text", path: "crm_contacts.email" },
  { key: "contact_phone",    label: "Phone",          type: "text", path: "crm_contacts.phone" },

  { key: "account_name",     label: "Company",        type: "text", path: "crm_accounts.name" },
  { key: "account_domain",   label: "Website",        type: "text", path: "crm_accounts.domain" },
  { key: "account_industry", label: "Industry",       type: "text", path: "crm_accounts.industry" },
  { key: "account_keywords", label: "Keywords",       type: "text", path: "crm_accounts.keywords" },
  { key: "account_city",     label: "City",           type: "text", path: "crm_accounts.city" },
  { key: "account_state",    label: "State",          type: "text", path: "crm_accounts.state" },
  { key: "account_country",  label: "Country",        type: "text", path: "crm_accounts.country" },

  { key: "client_name",      label: "Client",         type: "text", path: "org_clients.name" },
  { key: "campaign_name",    label: "Campaign",       type: "text", path: "crm_campaigns.name" },

  { key: "stage",            label: "Stage",          type: "picklist", path: "stage",       picklist: "stage" },
  { key: "lead_status",      label: "Lead status",    type: "picklist", path: "lead_status", picklist: "lead_status" },

  { key: "next_action_date", label: "Next action",    type: "date", path: "next_action_date" },
  { key: "opened_on",        label: "Opened",         type: "date", path: "opened_on" },
  { key: "close_date",       label: "Close date",     type: "date", path: "close_date" },
  { key: "closed_on",        label: "Closed",         type: "date", path: "closed_on" },
  { key: "updated_at",       label: "Last modified",  type: "date", path: "updated_at" },

  { key: "opportunity_name", label: "Opportunity",    type: "text", path: "name" },
  { key: "updates",          label: "Updates",        type: "text", path: "updates" },
  { key: "notes",            label: "Notes",          type: "text", path: "notes" },

  { key: "reached_lead",              label: "Reached: lead",       type: "boolean", path: "reached_lead" },
  { key: "reached_eval_call_scheduled", label: "Reached: eval call", type: "boolean", path: "reached_eval_call_scheduled" },
  { key: "reached_selling",           label: "Reached: selling",    type: "boolean", path: "reached_selling" },
  { key: "reached_discovery",         label: "Reached: discovery",  type: "boolean", path: "reached_discovery" },
  { key: "reached_proposal",          label: "Reached: proposal",   type: "boolean", path: "reached_proposal" },
  { key: "reached_closing",           label: "Reached: closing",    type: "boolean", path: "reached_closing" },
];

export const FIELD_BY_KEY = new Map(LIST_FIELDS.map((f) => [f.key, f]));

export type Operator =
  | "contains" | "not_contains" | "equals" | "not_equals"
  | "starts_with" | "not_starts_with"
  | "on" | "before" | "after" | "on_or_before" | "on_or_after"
  | "is_true" | "is_false"
  | "is_empty" | "is_not_empty";

export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: "contains",
  not_contains: "does not contain",
  equals: "equals",
  not_equals: "does not equal",
  starts_with: "starts with",
  not_starts_with: "does not start with",
  on: "on",
  before: "before",
  after: "after",
  on_or_before: "on or before",
  on_or_after: "on or after",
  is_true: "is checked",
  is_false: "is not checked",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const TEXT_OPS: Operator[] = [
  "contains", "not_contains", "equals", "not_equals",
  "starts_with", "not_starts_with", "is_empty", "is_not_empty",
];
const DATE_OPS: Operator[] = ["on", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"];
const BOOL_OPS: Operator[] = ["is_true", "is_false"];

export function operatorsFor(type: FieldType): Operator[] {
  if (type === "date") return DATE_OPS;
  if (type === "boolean") return BOOL_OPS;
  return TEXT_OPS;
}

/** Operators that ignore whatever is in the value box. */
export function opTakesNoValue(op: Operator): boolean {
  return op === "is_empty" || op === "is_not_empty" || op === "is_true" || op === "is_false";
}

export type Filter = { field: string; op: Operator; value?: string | null };

export type ListView = {
  id: string;
  name: string;
  owner_member_id: string | null;
  shared: boolean;
  columns: string[];
  filters: Filter[];
  sort_field: string | null;
  sort_dir: "asc" | "desc";
};

/*
 * Dates accept "today" as a value, because a view saved with a fixed date stops
 * being useful the next morning, and "next action on or before today" is the
 * list half the company lives in. Anything else is expected to be an ISO date
 * and is handed through as written -- a malformed one filters nothing rather
 * than erroring, which is the gentler failure on a saved view.
 */
export function resolveDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "today") return new Date().toISOString().slice(0, 10);
  if (v === "tomorrow" || v === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() + (v === "tomorrow" ? 1 : -1));
    return d.toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

/** Only keys this file knows, so a stale saved view degrades instead of breaking. */
export function knownColumns(columns: string[]): ListField[] {
  return columns.map((k) => FIELD_BY_KEY.get(k)).filter((f): f is ListField => Boolean(f));
}

export function knownFilters(filters: Filter[]): Filter[] {
  return (filters ?? []).filter((f) => {
    const field = FIELD_BY_KEY.get(f?.field);
    return Boolean(field) && operatorsFor(field!.type).includes(f.op);
  });
}

export const DEFAULT_COLUMNS = [
  "contact_name", "account_name", "client_name", "stage", "next_action_date", "updates",
];
