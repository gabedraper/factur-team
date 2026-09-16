/*
 * Every column and filter the clients table is allowed to offer.
 *
 * Same contract as the opportunities catalogue: a saved view stores keys from
 * this file and nothing else, so a filter arriving from the browser is either a
 * key declared here or it is dropped. There is no path from a saved view to a
 * query fragment.
 *
 * Unlike opportunities, each field carries a `read` rather than a PostgREST
 * path. org_clients is rebuilt by Coupler on every sync and so has no foreign
 * keys for PostgREST to follow -- the account manager, the team lead and the
 * service all arrive from separate reads and are stitched together in
 * lib/clients/directory. Filtering and sorting therefore happen over records
 * already in memory, which is affordable at roughly a thousand clients and
 * would not be at a million opportunities.
 */

import type { BaseField } from "@/lib/list-views/fields";

/** One client, as the directory assembles it. Every field below reads from this. */
export type ClientRecord = {
  id: string;
  name: string;
  status: string | null;
  domain: string | null;
  account_manager: string | null;
  team_lead: string | null;
  /** The most recent service period, which is not always one covering today. */
  service: string | null;
  tier: string | null;
  service_started: string | null;
  service_ended: string | null;
  monthly_rate: number | null;
  salesforce_id: string | null;
  created_at: string | null;
};

export type ClientValue = string | number | null;

export type ClientField = BaseField & {
  read: (r: ClientRecord) => ClientValue;
  /** How the cell draws. Text unless it needs a logo, a date or a figure. */
  render?: "identity" | "date" | "money" | "status";
  /** Right-aligned with tabular figures, so columns of numbers line up. */
  numeric?: boolean;
};

/*
 * Name first because it is what people scan for, then who owns the account,
 * then what we sell them. Roughly the order Salesforce puts an Account list in,
 * which is the point -- this is the screen people are moving off.
 */
export const CLIENT_FIELDS: ClientField[] = [
  { key: "name", label: "Client", type: "text", render: "identity", read: (r) => r.name },
  { key: "status", label: "Status", type: "picklist", picklist: "status", render: "status", read: (r) => r.status },
  { key: "domain", label: "Website", type: "text", read: (r) => r.domain },

  { key: "account_manager", label: "Account manager", type: "picklist", picklist: "account_manager", read: (r) => r.account_manager },
  { key: "team_lead", label: "Team lead", type: "picklist", picklist: "team_lead", read: (r) => r.team_lead },

  { key: "service", label: "Service", type: "picklist", picklist: "service", read: (r) => r.service },
  { key: "tier", label: "Tier", type: "picklist", picklist: "tier", read: (r) => r.tier },
  { key: "monthly_rate", label: "Monthly rate", type: "number", render: "money", numeric: true, read: (r) => r.monthly_rate },
  { key: "service_started", label: "Service started", type: "date", render: "date", read: (r) => r.service_started },
  { key: "service_ended", label: "Service ended", type: "date", render: "date", read: (r) => r.service_ended },

  { key: "created_at", label: "Added", type: "date", render: "date", read: (r) => r.created_at },
  { key: "salesforce_id", label: "Salesforce ID", type: "text", read: (r) => r.salesforce_id },
];

export const CLIENT_FIELD_BY_KEY = new Map(CLIENT_FIELDS.map((f) => [f.key, f]));

/*
 * What a person sees before they have chosen anything. The three the request
 * came in about -- account manager, team lead, service -- plus the name and
 * status a list is useless without.
 */
export const DEFAULT_CLIENT_COLUMNS = [
  "name", "status", "account_manager", "team_lead", "service",
];

/** Alphabetical unless a view says otherwise -- a client list is scanned by name. */
export const CLIENT_SORT_DEFAULT = "name";
