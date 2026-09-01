/*
 * Salesforce requires Name and CloseDate to create an Opportunity, and
 * Skyvia's sync writes as the Gaib user with triggers deliberately bypassed
 * -- so OpportunityHelper's own naming/CloseDate logic never fires for
 * app-originated rows. These two columns exist so the app supplies the same
 * values that logic would have, computed the same way, before the row ever
 * reaches Salesforce.
 */

alter table public.opportunities
  add column if not exists name text,
  add column if not exists close_date date;
