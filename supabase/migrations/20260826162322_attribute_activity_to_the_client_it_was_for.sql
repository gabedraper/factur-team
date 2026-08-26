-- Group an activity by the client the work was FOR, not the account it happens
-- to be attached to.
--
-- The activities screen grouped on "is this activity's Salesforce account a
-- client's account". That is true for a check-in with the client, and false for
-- almost everything else a prospecting rep does all day: an email to Coldfall
-- on behalf of Die Craft is attached to Coldfall. So the screen put most of the
-- work under "No client" even though every one of those rows was done for a
-- named client. It also missed activities sitting on duplicate Salesforce
-- accounts -- "Die Craft Inc" is a second account for a client whose real one
-- is "Die Craft Machining & Engineering", and 80 of the last 30 days' rows are
-- on the duplicate.
--
-- The client's name is usually in the text: in the account name, in the
-- sequence tag, or in the subject ("... and Die Craft Machining and Engineering
-- Connection"). So we match on text -- but by looking up a few keys from each
-- activity in an indexed table, NOT by testing every client name against every
-- row. The obvious way round costs 883 comparisons per activity and times out
-- on a single rep's month; this way is a couple of dozen index probes.

create table if not exists public.client_aliases (
  alias text primary key,
  client_name text not null,
  source text not null default 'auto',
  created_at timestamptz not null default now()
);

alter table public.client_aliases enable row level security;

drop policy if exists client_aliases_select on public.client_aliases;
create policy client_aliases_select on public.client_aliases
  for select using (public.is_factur_user());

comment on table public.client_aliases is
  'Short names that identify a client in free text. source=auto is derived from the client list and rebuilt; source=manual is hand-added and never overwritten.';


-- Derived from the client list: strip punctuation and corporate noise, keep the
-- first two words. An alias that would point at two different clients is
-- dropped rather than guessed at.
create or replace function public.refresh_client_aliases()
returns integer
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_count integer;
begin
  delete from public.client_aliases where source = 'auto';

  with cleaned as (
    select c.name as client_name,
      btrim(regexp_replace(
        regexp_replace(
          regexp_replace(lower(c.name), '[^a-z0-9 ]', ' ', 'g'),
          '\y(the|inc|llc|corp|corporation|co|company|ltd|limited|group|usa|plc|dba)\y', ' ', 'g'),
        '\s+', ' ', 'g')) as words
    from public.sf_clients_raw c
    where c.name is not null
  ), candidate as (
    select client_name,
           array_to_string((string_to_array(words, ' '))[1:2], ' ') as alias
    from cleaned
    where words <> ''
  ), unambiguous as (
    select alias, min(client_name) as client_name
    from candidate
    where length(alias) >= 5
      and alias not like 'factur%'
    group by alias
    having count(distinct client_name) = 1
  )
  insert into public.client_aliases (alias, client_name, source)
  select u.alias, u.client_name, 'auto' from unambiguous u
  on conflict (alias) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $fn$;

select public.refresh_client_aliases();


-- Which client a piece of text is about.
--
-- Cuts the text into single words and adjacent pairs and looks those up, so the
-- work per activity is a handful of index probes against client_aliases rather
-- than a scan of it. The account name wins over the subject; a two-word match
-- wins over one word; and among equals the LAST match in the subject wins,
-- because these subjects read "<prospect> and <client> - Next Steps".
create or replace function public.client_from_text(p_account_name text, p_subject text)
returns text
language sql stable
set search_path = public, pg_catalog
as $fn$
  with src as (
    select 2 as rank,
           string_to_array(btrim(regexp_replace(regexp_replace(
             lower(coalesce(p_account_name, '')), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')), ' ') as w
    union all
    select 1,
           string_to_array(btrim(regexp_replace(regexp_replace(
             lower(coalesce(p_subject, '')), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')), ' ')
  ), cand as (
    select s.rank, i as pos, s.w[i] as key
    from src s, generate_subscripts(s.w, 1) i
    where s.w[i] <> ''
    union all
    select s.rank, i, s.w[i] || ' ' || s.w[i + 1]
    from src s, generate_subscripts(s.w, 1) i
    where i < array_length(s.w, 1) and s.w[i] <> '' and s.w[i + 1] <> ''
  )
  select a.client_name
  from cand c
  join public.client_aliases a on a.alias = c.key
  order by c.rank desc, length(c.key) desc, c.pos desc
  limit 1;
$fn$;

grant execute on function public.client_from_text(text, text) to authenticated;


-- The screen's query, now falling back to the text when the account is not a
-- client's own account.
create or replace function public.get_rep_activities(
  p_rep_id uuid, p_start date, p_end date)
returns jsonb
language sql stable security definer
set search_path = public, pg_catalog
as $fn$
  select coalesce(jsonb_agg(t order by t.client_name nulls last, t.account_name nulls last,
                            t.effort_source, t.activity_date desc), '[]'::jsonb)
  from (
    select
      ra.id            as activity_id,
      ra.activity_date,
      ra.effort_source,
      ra.subject,
      ra.account_name,
      coalesce(cl.name, public.client_from_text(ra.account_name, ra.subject)) as client_name,
      case
        when ra.activity_type = 'Meeting'
          then 'https://factur.lightning.force.com/lightning/r/Event/' || ra.id || '/view'
        else 'https://factur.lightning.force.com/lightning/r/Task/' || ra.id || '/view'
      end              as sf_link,
      coalesce(oa.original_effort_source, os.original_effort_source) as original_effort_source,
      (oa.id is not null or os.id is not null) as overridden,
      (os.id is not null)                      as overridden_by_subject,
      coalesce(oa.set_by_email, os.set_by_email) as set_by_email
    from public.raw_activities ra
    join public.reps r on r.salesforce_owner_id = ra.salesforce_owner_id
    left join lateral (
      select c.name from public.sf_clients_raw c
      where c.client_account__c = ra.account_id
      limit 1
    ) cl on true
    left join public.activity_type_overrides oa
      on oa.activity_id = ra.id
    left join public.activity_type_overrides os
      on os.subject = ra.subject
     and os.salesforce_owner_id = ra.salesforce_owner_id
     and os.activity_id is null
    where r.id = p_rep_id
      and ra.activity_date >= p_start
      and ra.activity_date <= p_end
      and ra.is_dedup_primary
      and public.is_factur_user()
  ) t;
$fn$;
