/*
 * A nightly pass over everything, to catch what the incremental runs cannot.
 *
 * The three-minute transform only looks at rows Salesforce changed in the last
 * few minutes. That is the right window almost always, and wrong in one specific
 * case: a row that arrived in the mirror but could not be placed yet.
 *
 * An opportunity needs a client, a contact and an account to exist first --
 * client_id and contact_id are NOT NULL -- so one whose client has not landed is
 * skipped rather than forced in. Clients arrive on a different schedule
 * entirely: Coupler into sf_clients_raw, then sync-clients-hourly at 25 past.
 * So a client created in Salesforce is up to an hour behind its own
 * opportunities, which arrive within three minutes.
 *
 * By the time the client lands, those opportunities are long outside the
 * five-minute window and no incremental run will ever look at them again. They
 * would sit stranded until somebody happened to edit them in Salesforce.
 *
 * Passing null re-reads the whole mirror, which takes about ten minutes and
 * upserts mostly rows that have not changed -- wasteful, and far cheaper than the
 * alternative of not noticing. 3:20am, away from the nightly maintenance at 2:15
 * and the hourly client sync at :25.
 */

select cron.schedule(
  'salesforce-catchup-nightly',
  '20 3 * * *',
  $cron$
  select public.run_once(
    'salesforce-catchup-nightly',
    'select public.apply_salesforce_transforms(null)'
  );
  $cron$
);

comment on function public.apply_salesforce_transforms(timestamptz) is
  'Runs every Salesforce transform. Called with a watermark by the three-minute incremental job, and with null by the nightly catch-up that rescues rows whose client, contact or account arrived late.';
