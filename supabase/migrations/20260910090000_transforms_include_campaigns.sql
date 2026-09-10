/*
 * Campaigns join the transform run.
 *
 * Order matters and it is the same reasoning as everything else in here:
 * campaigns before opportunities because a pursuit resolves its CampaignId
 * against crm_campaigns, and the attach step last because it needs both sides
 * to exist. Clients still lead, since an opportunity needs one.
 *
 * The attach is its own step rather than a column inside the opportunity
 * transform. That one matches on (client, contact) and dedups by stage; a
 * campaign link is a different question with a different key, and folding it in
 * would mean touching that logic every time a lookup gets added.
 */
create or replace function public.apply_salesforce_transforms(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  r := jsonb_build_object(
    'clients',       public.sync_org_clients_from_salesforce(p_since),
    'campaigns',     public.sync_crm_campaigns_from_salesforce(p_since),
    'accounts',      public.sync_crm_accounts_from_salesforce(p_since),
    'contacts',      public.sync_crm_contacts_from_salesforce(p_since),
    'opportunities', public.sync_opportunities_from_salesforce(p_since),
    'campaign_links', public.attach_opportunity_campaigns(p_since),
    'activities',    public.sync_opp_activities_from_salesforce(p_since)
  );
  return r;
end;
$function$;

revoke all on function public.apply_salesforce_transforms(timestamptz) from public, anon;
grant execute on function public.apply_salesforce_transforms(timestamptz) to service_role;


/*
 * A watermark so the fetch route will pick Campaign up.
 *
 * The route refuses an object with no watermark -- that means "the bulk load has
 * not run for this one", and loading a million rows through the API is the slow
 * path we left behind. Campaign is 359 records, so the backfill it is warning
 * about does not apply: an old marker simply makes the next run pull the lot.
 */
insert into public.salesforce_sync_state (object, watermark)
values ('Campaign', timestamptz '2000-01-01')
on conflict (object) do nothing;
