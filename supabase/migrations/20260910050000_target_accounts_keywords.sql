/*
 * Keywords on the company list, and reachable from the search box.
 *
 * The list carried Contacts, Next action and Last activity. On a screen whose
 * job is deciding which company to get into, those are three columns of the
 * same "1" and two dates that say when somebody last touched it -- true, and no
 * help at all in choosing. Industry and Keywords say what the company makes,
 * which is the thing you are actually sorting on.
 *
 * Search now reaches keywords and industry as well as name and domain. The
 * keywords are the company's own words -- "plugs, caps, hightemp masking,
 * tubing inserts" -- so looking for "castings" finds the shop that pours them
 * even when nothing in its name admits it. That is the difference between a
 * list you filter and a list you can prospect from.
 */

drop function if exists public.pipeline_target_accounts(uuid, text[], text, boolean, integer, integer);

create function public.pipeline_target_accounts(
  p_client_id uuid,
  p_stages    text[] default null,
  p_search    text   default null,
  p_open_only boolean default false,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  account_id        uuid,
  account_name      text,
  domain            text,
  industry          text,
  keywords          text,
  city              text,
  state             text,
  country           text,
  target_stage      text,
  stage_rank        integer,
  contacts          bigint,
  open_contacts     bigint,
  next_action_date  date,
  last_activity_at  timestamptz,
  latest_update     text,
  total_count       bigint
)
language sql
stable
as $function$
  with rolled as (
    select
      o.account_id,
      max(public.target_account_stage_rank(public.target_account_stage(o.stage))) as stage_rank,
      count(*)                                                  as contacts,
      count(*) filter (where o.stage not like 'Closed%')         as open_contacts,
      min(o.next_action_date) filter (where o.next_action_date >= current_date) as next_action_date,
      max(o.updated_at)                                         as last_touch
    from public.opportunities o
    where o.client_id = p_client_id
      and o.account_id is not null
      and (not p_open_only or o.stage not like 'Closed%')
    group by o.account_id
  ),
  named as (
    select r.*, a.name, a.domain, a.industry, a.keywords, a.city, a.state, a.country,
           /* Rank back to a label once, rather than per row in the app. */
           case r.stage_rank
             when 7 then 'Closing' when 6 then 'Opportunity Found'
             when 5 then 'Qualifying' when 4 then 'Long-Term Follow Up'
             when 3 then 'Engaged' when 2 then 'Engaging'
             when 1 then 'Cold Target' else 'Closed'
           end as target_stage
    from rolled r
    join public.crm_accounts a on a.id = r.account_id
    where (p_search is null or p_search = ''
           or a.name ilike '%' || p_search || '%'
           or a.domain ilike '%' || p_search || '%'
           /* Keywords are the company's own words for what they make, so a
              search for "castings" should find the shop that pours them even
              when nothing in the name says so. */
           or a.keywords ilike '%' || p_search || '%'
           or a.industry ilike '%' || p_search || '%')
  ),
  filtered as (
    select * from named
    where p_stages is null or cardinality(p_stages) = 0 or target_stage = any (p_stages)
  )
  select
    f.account_id, f.name, f.domain, f.industry, f.keywords, f.city, f.state, f.country,
    f.target_stage, f.stage_rank, f.contacts, f.open_contacts, f.next_action_date,
    (select max(act.occurred_at) from public.opp_activities act
      join public.opportunities o2 on o2.id = act.opportunity_id
     where o2.client_id = p_client_id and o2.account_id = f.account_id),
    (select o3.updates from public.opportunities o3
      where o3.client_id = p_client_id and o3.account_id = f.account_id
        and o3.updates is not null
      order by o3.updated_at desc limit 1),
    count(*) over ()
  from filtered f
  order by f.stage_rank desc, f.next_action_date nulls last, f.name
  limit greatest(1, least(p_limit, 200))
  offset greatest(0, p_offset);
$function$;

revoke all on function public.pipeline_target_accounts(uuid, text[], text, boolean, integer, integer) from public, anon;
grant execute on function public.pipeline_target_accounts(uuid, text[], text, boolean, integer, integer) to authenticated, service_role;
