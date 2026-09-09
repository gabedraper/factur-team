/*
 * The people inside a target account, and the ones not being worked yet.
 *
 * Two lists, because they answer different questions. The first is "who are we
 * talking to here and where has it got to" -- contacts this client already has a
 * pursuit against. The second is "who else is there" -- people at the same
 * company that nobody has started on, which is where the next move usually comes
 * from once a company is warm.
 *
 * The second list is why an account screen is worth having at all. A pursuit is
 * per-contact, so without this view a rep can only see the doors they have
 * already knocked on, never the ones beside them.
 */

/*
 * Cost note: the composite index below took the target account list from 5.5
 * seconds to 314ms for the largest client. The list ranks the most engaged
 * accounts first, those have the most activity, and every row asks "what
 * happened most recently here" -- which is a (client, account) lookup, and had
 * no index that served it.
 */
create index if not exists opportunities_client_account_idx
  on public.opportunities (client_id, account_id);


create or replace function public.pipeline_account_contacts(
  p_client_id  uuid,
  p_account_id uuid
)
returns table (
  opportunity_id   uuid,
  contact_id       uuid,
  first_name       text,
  last_name        text,
  title            text,
  email            text,
  phone            text,
  stage            text,
  target_stage     text,
  lead_status      text,
  next_action_date date,
  updates          text,
  opened_on        date,
  last_activity_at timestamptz,
  activity_count   bigint
)
language sql
stable
as $function$
  select
    o.id, c.id, c.first_name, c.last_name, c.title, c.email, c.phone,
    o.stage,
    public.target_account_stage(o.stage),
    o.lead_status, o.next_action_date, o.updates, o.opened_on,
    a.last_at, coalesce(a.n, 0)
  from public.opportunities o
  join public.crm_contacts c on c.id = o.contact_id
  left join lateral (
    select max(act.occurred_at) as last_at, count(*) as n
    from public.opp_activities act where act.opportunity_id = o.id
  ) a on true
  where o.client_id = p_client_id
    and o.account_id = p_account_id
  order by
    public.target_account_stage_rank(public.target_account_stage(o.stage)) desc,
    o.next_action_date nulls last,
    c.last_name, c.first_name;
$function$;

comment on function public.pipeline_account_contacts(uuid, uuid) is
  'Contacts at one account that this client is already pursuing, with where each pursuit stands.';


/*
 * People at the same company with no pursuit from this client yet.
 *
 * Matched on the contact's own account, so it only finds people Salesforce has
 * already filed under that company -- it does not guess by email domain. Capped,
 * because a large manufacturer can have hundreds of contacts and this is a
 * "who else is here" prompt, not a directory.
 */
create or replace function public.pipeline_account_unworked_contacts(
  p_client_id  uuid,
  p_account_id uuid,
  p_limit      integer default 50
)
returns table (
  contact_id uuid,
  first_name text,
  last_name  text,
  title      text,
  email      text,
  phone      text,
  other_clients_pursuing bigint
)
language sql
stable
as $function$
  select
    c.id, c.first_name, c.last_name, c.title, c.email, c.phone,
    (select count(*) from public.opportunities o2
      where o2.contact_id = c.id and o2.stage not like 'Closed%')
  from public.crm_contacts c
  where c.account_id = p_account_id
    and not exists (
      select 1 from public.opportunities o
      where o.client_id = p_client_id and o.contact_id = c.id
    )
  order by c.last_name, c.first_name
  limit greatest(1, least(p_limit, 200));
$function$;

comment on function public.pipeline_account_unworked_contacts(uuid, uuid, integer) is
  'People at an account this client has no pursuit against yet. other_clients_pursuing shows if somebody else is already on them.';

revoke all on function public.pipeline_account_contacts(uuid, uuid) from public, anon;
revoke all on function public.pipeline_account_unworked_contacts(uuid, uuid, integer) from public, anon;
grant execute on function public.pipeline_account_contacts(uuid, uuid) to authenticated, service_role;
grant execute on function public.pipeline_account_unworked_contacts(uuid, uuid, integer) to authenticated, service_role;


/*
 * The clients a viewer can open, with enough on each row to choose between them.
 * RLS on opportunities does the access control, so a client with no visible
 * pursuits simply does not appear.
 */
create or replace function public.pipeline_clients()
returns table (
  client_id       uuid,
  name            text,
  status          text,
  active          boolean,
  target_accounts bigint,
  open_accounts   bigint,
  open_contacts   bigint,
  next_action_date date
)
language sql
stable
as $function$
  select
    cl.id, cl.name, cl.status, cl.active,
    count(distinct o.account_id),
    count(distinct o.account_id) filter (where o.stage not like 'Closed%'),
    count(*) filter (where o.stage not like 'Closed%'),
    min(o.next_action_date) filter (where o.next_action_date >= current_date)
  from public.org_clients cl
  join public.opportunities o on o.client_id = cl.id
  group by cl.id, cl.name, cl.status, cl.active
  order by cl.active desc, cl.name;
$function$;

comment on function public.pipeline_clients() is
  'Clients the viewer can see, with target account and open pursuit counts. The starting point of the pipeline screens.';

revoke all on function public.pipeline_clients() from public, anon;
grant execute on function public.pipeline_clients() to authenticated, service_role;
