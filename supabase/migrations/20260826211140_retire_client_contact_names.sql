/*
 * client_contact_names is retired into client_contacts.
 *
 * It was keyed on the address alone, with no client and no role -- the right
 * size for closing the "Hi there" gap it was built for a few hours earlier, and
 * the wrong size for holding what a contact actually is. All 183 names were
 * verified onto contacts before this ran.
 *
 * Backfill that preceded it, for the record:
 *   - primary        <- sf_clients_raw.client_main_contact_email__c
 *   - decision_maker <- sf_clients_raw.client_decision_maker_contact_email__c
 *   - billing        <- the billing address on the most recent QuickBooks
 *                       invoice, falling back to the customer record, split on
 *                       commas so the 18 clients holding two get two rows
 *   - names          <- client_contact_names, matched on address
 * 1,751 contacts across 853 clients.
 */
drop table if exists public.client_contact_names;
