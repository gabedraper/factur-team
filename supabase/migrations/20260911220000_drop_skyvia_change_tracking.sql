/*
 * Skyvia's change tracking, removed.
 *
 * Skyvia's Synchronization package -- bidirectional, and banned on 8 September
 * after it read 8.2 billion rows in five days and wrote none -- installed
 * triggers on opportunities, crm_contacts and crm_accounts that record the id
 * of every inserted, updated and deleted row into *_tracking_store tables. They
 * kept running after the package was disarmed: 2.6 million rows and about
 * 490 MB by 11 September, an extra write on every one of the inbound sync's
 * updates, and nothing in the app has ever read them.
 *
 * The real reason to remove them is what they are for. They are the list
 * Synchronization would push into Salesforce if anyone ever re-armed it -- all
 * 780,000 opportunities, since every one has been written since the tables
 * were created. The app's own write-back (20260911210000) is now the one path
 * into Salesforce, and it logs every field it sends. Two paths would make that
 * log meaningless.
 */

drop trigger if exists public_opportunities_i on public.opportunities;
drop trigger if exists public_opportunities_u on public.opportunities;
drop trigger if exists public_opportunities_d on public.opportunities;
drop trigger if exists public_crm_contacts_i  on public.crm_contacts;
drop trigger if exists public_crm_contacts_u  on public.crm_contacts;
drop trigger if exists public_crm_contacts_d  on public.crm_contacts;
drop trigger if exists public_crm_accounts_i  on public.crm_accounts;
drop trigger if exists public_crm_accounts_u  on public.crm_accounts;
drop trigger if exists public_crm_accounts_d  on public.crm_accounts;

drop function if exists public.opportunities_i_f();
drop function if exists public.opportunities_u_f();
drop function if exists public.opportunities_d_f();
drop function if exists public.crm_contacts_i_f();
drop function if exists public.crm_contacts_u_f();
drop function if exists public.crm_contacts_d_f();
drop function if exists public.crm_accounts_i_f();
drop function if exists public.crm_accounts_u_f();
drop function if exists public.crm_accounts_d_f();

drop table if exists public.opportunities_tracking_store;
drop table if exists public.crm_contacts_tracking_store;
drop table if exists public.crm_accounts_tracking_store;
