/*
 * A third way a survey can have gone out: by hand.
 *
 * 'app' is a campaign this app sent; 'website-form' is the WordPress form on
 * facturmfg.com. Neither covers a sequence someone ran themselves out of
 * MixMax and logged in a spreadsheet -- and filing that under 'website-form'
 * would make the form's own response-rate figures quietly wrong.
 */
alter table public.nps_campaigns drop constraint if exists nps_campaigns_source_check;

alter table public.nps_campaigns
  add constraint nps_campaigns_source_check
  check (source in ('app', 'website-form', 'manual'));
