/*
 * Target Contacts filters by the stage it shows.
 *
 * This function was written by copying the one behind Target Companies, and it
 * kept that screen's filter: p_stages was matched against the rolled-up band,
 * the eight Cold Target / Engaging / Qualifying names. Those are right there,
 * where every row is a company wearing a band. They are wrong here, where every
 * row wears its own Salesforce stage -- so the filters along the top named a
 * ladder OSDR and OBDM do not work, and none of them named anything a reader
 * could see on the rows underneath.
 *
 * One line: the stage the rows show is the stage they filter by. Equals on a
 * picklist seeks (client_id, stage) rather than computing a band per pursuit,
 * so it is the cheaper half as well.
 *
 * target_stage still comes back on every row -- it is what colours the chip.
 * Nothing about the roll-up is wrong; it just is not what this screen filters
 * on.
 */

create or replace function public.pipeline_target_contacts(
  p_client_id uuid,
  p_stages    text[] default null,
  p_search    text   default null,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  opportunity_id    uuid,
  contact_id        uuid,
  account_id        uuid,
  account_name      text,
  first_name        text,
  last_name         text,
  title             text,
  email             text,
  phone             text,
  updates           text,
  next_action_date  date,
  stage             text,
  lead_status       text,
  target_stage      text,
  stage_rank        integer,
  total_count       bigint
)
language sql
stable
as $function$
  with rows_ as (
    select
      o.id, o.contact_id, o.account_id,
      a.name as account_name,
      k.first_name, k.last_name, k.title, k.email, k.phone,
      o.updates, o.next_action_date, o.stage, o.lead_status,
      public.target_account_stage(o.stage) as target_stage,
      public.target_account_stage_rank(public.target_account_stage(o.stage)) as stage_rank
    from public.opportunities o
    join public.crm_contacts k on k.id = o.contact_id
    left join public.crm_accounts a on a.id = o.account_id
    where o.client_id = p_client_id
      and (p_search is null or p_search = ''
           or k.first_name ilike '%' || p_search || '%'
           or k.last_name  ilike '%' || p_search || '%'
           or k.email      ilike '%' || p_search || '%'
           or k.title      ilike '%' || p_search || '%'
           or a.name       ilike '%' || p_search || '%')
  ),
  filtered as (
    select * from rows_
    where p_stages is null or cardinality(p_stages) = 0 or stage = any (p_stages)
  )
  select
    f.id, f.contact_id, f.account_id, f.account_name,
    f.first_name, f.last_name, f.title, f.email, f.phone,
    f.updates, f.next_action_date, f.stage, f.lead_status,
    f.target_stage, f.stage_rank,
    count(*) over ()
  from filtered f
  /* Company first so the groups hold together, then the furthest-along person
     in each, since that is the one worth reading first. */
  order by f.account_name nulls last, f.stage_rank desc, f.last_name, f.first_name
  limit greatest(1, least(p_limit, 200))
  offset greatest(0, p_offset);
$function$;

comment on function public.pipeline_target_contacts(uuid, text[], text, integer, integer) is
  'One row per pursuit for a client, ordered so a company''s people arrive together. Filtered by the Salesforce stage the rows show. Both progress fields are returned; the screen shows whichever the viewer''s role reads.';

revoke all on function public.pipeline_target_contacts(uuid, text[], text, integer, integer) from public, anon;
grant execute on function public.pipeline_target_contacts(uuid, text[], text, integer, integer) to authenticated, service_role;
