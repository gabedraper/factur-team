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

/*
 * The field types, operators and view shape now live in lib/list-views/fields,
 * shared with the clients list. They are re-exported here so everything that
 * reads opportunity fields keeps importing them from one place.
 */
export {
  OPERATOR_LABELS, operatorsFor, opTakesNoValue, resolveDate,
} from "@/lib/list-views/fields";
export type { FieldType, Filter, ListView, Operator } from "@/lib/list-views/fields";

import {
  columnsKnownTo, filtersKnownTo,
  type BaseField, type Filter,
} from "@/lib/list-views/fields";

export type ListField = BaseField & {
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
  { key: "contact_linkedin", label: "LinkedIn",       type: "text", path: "crm_contacts.linkedin_url" },

  { key: "account_name",     label: "Company",        type: "text", path: "crm_accounts.name" },
  { key: "account_domain",   label: "Website",        type: "text", path: "crm_accounts.domain" },
  { key: "account_industry", label: "Industry",       type: "text", path: "crm_accounts.industry" },
  { key: "account_keywords", label: "Keywords",       type: "text", path: "crm_accounts.keywords" },
  { key: "account_city",     label: "City",           type: "text", path: "crm_accounts.city" },
  { key: "account_state",    label: "State",          type: "text", path: "crm_accounts.state" },
  { key: "account_country",  label: "Country",        type: "text", path: "crm_accounts.country" },

  { key: "client_name",      label: "Client",         type: "text", path: "org_clients.name" },
  /* Salesforce's Opportunity Owner, matched to a team member by their
     Salesforce user id. Opportunities whose owner has left stay blank here. */
  { key: "owner_name",       label: "Owner",          type: "text", path: "org_members.full_name" },
  { key: "campaign_name",    label: "Campaign",       type: "text", path: "crm_campaigns.name" },

  { key: "stage",            label: "Stage",          type: "picklist", path: "stage",       picklist: "stage" },
  { key: "lead_status",      label: "Lead status",    type: "picklist", path: "lead_status", picklist: "lead_status" },

  /* From Salesforce's Quote and Order objects, summarised onto the row by the
     sync (refresh_opportunity_commerce) so a list can sort and filter on them.
     "Amount" is Quote_Amount__c / PO_Amount__c -- the typed figure; Salesforce's
     own totals are line-item sums and nobody here uses line items. */
  { key: "order_count",         label: "Orders",         type: "number", path: "order_count" },
  { key: "orders_total",        label: "PO total",       type: "number", path: "orders_total" },
  { key: "latest_order_on",     label: "Last PO",        type: "date",   path: "latest_order_on" },
  { key: "latest_order_amount", label: "Last PO amount", type: "number", path: "latest_order_amount" },
  { key: "quote_count",         label: "Quotes",         type: "number", path: "quote_count" },
  { key: "quotes_total",        label: "Quotes total",   type: "number", path: "quotes_total" },
  { key: "latest_quote_on",     label: "Last quoted",    type: "date",   path: "latest_quote_on" },
  { key: "latest_quote_status", label: "Quote status",   type: "text",   path: "latest_quote_status" },
  { key: "latest_quote_amount", label: "Last quote amount", type: "number", path: "latest_quote_amount" },

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

/** Only keys this file knows, so a stale saved view degrades instead of breaking. */
export function knownColumns(columns: string[]): ListField[] {
  return columnsKnownTo(FIELD_BY_KEY, columns);
}

export function knownFilters(filters: Filter[]): Filter[] {
  return filtersKnownTo(FIELD_BY_KEY, filters);
}

export const DEFAULT_COLUMNS = [
  "contact_name", "account_name", "client_name", "stage", "next_action_date", "updates",
];
