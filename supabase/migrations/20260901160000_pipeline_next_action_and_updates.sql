/*
 * Two fields reps actually work in day to day, added on request once the
 * core pipeline sync was live: when to follow up, and a running note.
 * Both editable from the app and synced both ways with Salesforce's
 * Next_Action__c / Updates__c -- unlike the Reached_* funnel checkboxes,
 * these aren't tracked in opportunity_history; that table is for
 * funnel-stage progression, not a general field audit log.
 */

alter table public.opportunities
  add column if not exists next_action_date date,
  add column if not exists updates text;
