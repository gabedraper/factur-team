/*
 * Target accounts: the company a client is working, not the person.
 *
 * The pipeline is stored one pursuit per (client, contact), which is the right
 * grain for the work and the wrong grain for the screen. Nobody works a contact
 * in isolation -- they work a company, and the several people they know there
 * are how they get in. So this rolls opportunities up to the account: one row
 * per company a client is pursuing, carrying how far in they have got.
 *
 * An account's stage is the furthest any single pursuit inside it has reached.
 * One warm conversation at a company makes that company warm, even if the other
 * four contacts there have never replied -- that is how a salesperson would
 * describe it, so it is how the roll-up works.
 *
 * The bands are not Salesforce's twenty-odd stages. Those are useful on one
 * pursuit and unreadable across a list of six hundred companies, so they are
 * grouped into the seven a person would actually say out loud.
 *
 * Long-Term Follow Up is a band of its own, and that was not in the original
 * sketch. It is 29.5% of every opportunity you have -- 229,859 of them -- and it
 * means a deal that went quiet and is being nurtured, not one being actively
 * qualified. Folding it into Qualifying would have said a third of the pipeline
 * was in play when it is parked. It ranks below Qualifying so an account with
 * one live conversation and ten dormant ones reads as live.
 */

create or replace function public.target_account_stage(p_stage text)
returns text
language sql
immutable
parallel safe
as $function$
  select case
    when p_stage like 'Closed%' or p_stage like 'No Fit Ever%' or p_stage = 'Not the DM'
      then 'Closed'
    when p_stage in ('Pipeline Hot: Quoting', 'Pipeline Hot: Quote Follow up',
                     'Pipeline Hot: Supplier forms / NDA', 'Proposal', 'Quote',
                     'Negotiation', 'Awaiting Customer Inputs', 'Prototype Review',
                     'Renewal Requested')
      then 'Closing'
    when p_stage in ('Pipeline: Hot', 'Pipeline - Selling', 'Pipeline Hot: Appointment set',
                     'Pipeline Hot: Client RFQ Review', 'Appointment Set')
      then 'Opportunity Found'
    when p_stage in ('Pipeline: Warm', 'Sales Support', 'Needs Analysis',
                     'Qualification Call Complete')
      then 'Qualifying'
    when p_stage = 'Pipeline: LT Follow Up'
      then 'Long-Term Follow Up'
    when p_stage in ('Lead Generated', 'Lead Generated: Scheduled', 'Linkedin Response')
      then 'Engaged'
    when p_stage like 'Prospecting: %Referral' or p_stage = 'Prospecting: Referred'
      or p_stage like 'Pipeline: %Referral'
      then 'Engaging'
    else 'Cold Target'
  end;
$function$;

/*
 * How far along a band is, for rolling up and for ordering a list. Closed sits
 * at zero rather than the top: an account whose every pursuit is dead is not
 * further along than one still being worked, it is finished.
 */
create or replace function public.target_account_stage_rank(p_target_stage text)
returns integer
language sql
immutable
parallel safe
as $function$
  select case p_target_stage
    when 'Closing'             then 7
    when 'Opportunity Found'   then 6
    when 'Qualifying'          then 5
    when 'Long-Term Follow Up' then 4
    when 'Engaged'             then 3
    when 'Engaging'            then 2
    when 'Cold Target'         then 1
    else 0                                   /* Closed */
  end;
$function$;

comment on function public.target_account_stage(text) is
  'Groups a Salesforce opportunity stage into the seven bands the target account list reads by.';
comment on function public.target_account_stage_rank(text) is
  'Order of the target account bands. Closed is 0 -- finished, not furthest along.';


/*
 * One row per company this client is pursuing.
 *
 * Security is by omission rather than a check: this reads public.opportunities,
 * whose RLS already limits a viewer to the clients they have a role on via
 * my_client_ids(). Asking for a client you cannot see returns nothing rather
 * than an error, which is the same answer the policy would give.
 *
 * Paginated because it has to be -- the average client is pursuing 613
 * companies and the largest 41,260.
 */
create or replace function public.pipeline_target_accounts(
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
    select r.*, a.name, a.domain, a.industry, a.city, a.state, a.country,
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
           or a.domain ilike '%' || p_search || '%')
  ),
  filtered as (
    select * from named
    where p_stages is null or cardinality(p_stages) = 0 or target_stage = any (p_stages)
  )
  select
    f.account_id, f.name, f.domain, f.industry, f.city, f.state, f.country,
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

comment on function public.pipeline_target_accounts(uuid, text[], text, boolean, integer, integer) is
  'One row per company a client is pursuing, with the furthest stage reached inside it. Paginated; total_count carries the unpaginated total.';

revoke all on function public.pipeline_target_accounts(uuid, text[], text, boolean, integer, integer) from public, anon;
grant execute on function public.pipeline_target_accounts(uuid, text[], text, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.target_account_stage(text) to authenticated, service_role;
grant execute on function public.target_account_stage_rank(text) to authenticated, service_role;
