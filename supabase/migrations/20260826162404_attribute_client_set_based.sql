-- The previous migration resolved the client with a per-row function. It was
-- correct and far too slow: 6.4 seconds for one rep's month, because a SQL
-- function containing CTEs and set-returning calls does not get inlined, so
-- every activity paid for its own little query.
--
-- Same rule, done once for the whole page instead of once per row: cut every
-- activity's account name and subject into words and adjacent pairs, join the
-- lot to client_aliases in a single hash join, and keep the best match per
-- activity. 595ms for the same 3,452 rows.
create or replace function public.text_words(p_text text)
returns text[]
language sql immutable
set search_path = pg_catalog
as $fn$
  select string_to_array(
    btrim(regexp_replace(regexp_replace(
      lower(coalesce(p_text, '')), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')), ' ');
$fn$;

create or replace function public.get_rep_activities(
  p_rep_id uuid, p_start date, p_end date)
returns jsonb
language sql stable security definer
set search_path = public, pg_catalog
as $fn$
  with acts as (
    select ra.id, ra.activity_date, ra.effort_source, ra.subject,
           ra.account_name, ra.account_id, ra.activity_type, ra.salesforce_owner_id
    from public.raw_activities ra
    join public.reps r on r.salesforce_owner_id = ra.salesforce_owner_id
    where r.id = p_rep_id
      and ra.activity_date >= p_start
      and ra.activity_date <= p_end
      and ra.is_dedup_primary
      and public.is_factur_user()
  ),
  -- The account name outranks the subject; both are cut into single words and
  -- adjacent pairs so the alias table can be probed by equality.
  words as (
    select a.id, 2 as rank, public.text_words(a.account_name) as w from acts a
    union all
    select a.id, 1, public.text_words(a.subject) from acts a
  ),
  cand as (
    select id, rank, i as pos, w[i] as key
    from words, generate_subscripts(w, 1) i
    where w[i] <> ''
    union all
    select id, rank, i, w[i] || ' ' || w[i + 1]
    from words, generate_subscripts(w, 1) i
    where i < array_length(w, 1) and w[i] <> '' and w[i + 1] <> ''
  ),
  matched as (
    select distinct on (c.id) c.id, al.client_name
    from cand c
    join public.client_aliases al on al.alias = c.key
    order by c.id, c.rank desc, length(c.key) desc, c.pos desc
  )
  select coalesce(jsonb_agg(t order by t.client_name nulls last, t.account_name nulls last,
                            t.effort_source, t.activity_date desc), '[]'::jsonb)
  from (
    select
      a.id             as activity_id,
      a.activity_date,
      a.effort_source,
      a.subject,
      a.account_name,
      coalesce(cl.name, m.client_name) as client_name,
      case
        when a.activity_type = 'Meeting'
          then 'https://factur.lightning.force.com/lightning/r/Event/' || a.id || '/view'
        else 'https://factur.lightning.force.com/lightning/r/Task/' || a.id || '/view'
      end              as sf_link,
      coalesce(oa.original_effort_source, os.original_effort_source) as original_effort_source,
      (oa.id is not null or os.id is not null) as overridden,
      (os.id is not null)                      as overridden_by_subject,
      coalesce(oa.set_by_email, os.set_by_email) as set_by_email
    from acts a
    left join lateral (
      select c.name from public.sf_clients_raw c
      where c.client_account__c = a.account_id
      limit 1
    ) cl on true
    left join matched m on m.id = a.id
    left join public.activity_type_overrides oa
      on oa.activity_id = a.id
    left join public.activity_type_overrides os
      on os.subject = a.subject
     and os.salesforce_owner_id = a.salesforce_owner_id
     and os.activity_id is null
  ) t;
$fn$;

-- Aliases follow the client list, so they need rebuilding as clients are added.
-- Its own job rather than another step inside nightly_maintenance, which is
-- close enough to its limit already.
select cron.schedule('refresh-client-aliases', '30 13 * * *',
  'select public.refresh_client_aliases();');
