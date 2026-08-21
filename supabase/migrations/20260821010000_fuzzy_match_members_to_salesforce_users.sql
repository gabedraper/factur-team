-- Tying an app person to their Salesforce user, so opportunities and activities
-- land against the right person.
--
-- Exact email is the only reliable key, and it fails often here: staff appear
-- as name@bethefactur.com in Salesforce and first.last@facturmfg.com in the
-- directory. That mismatch had already produced six duplicate people. So this
-- scores candidates and leaves the deciding to a human -- it never links
-- anything on its own, because the near-misses are dangerous: "Matt Cool"
-- scores 0.50 against "Matt Beaver".

create extension if not exists pg_trgm;

create or replace function public.suggest_salesforce_matches(p_member_id uuid)
returns table (salesforce_user_id text, sf_name text, sf_email text, score numeric, basis text)
language sql stable security definer
set search_path = public, pg_catalog, extensions
as $$
  with me as (
    select lower(email) as email, lower(coalesce(full_name, '')) as name,
           -- "first.last@..." and "First Last" are the same person spelled two
           -- ways; comparing the local part with dots turned to spaces catches
           -- most of the domain changes.
           replace(split_part(lower(email), '@', 1), '.', ' ') as email_as_name
    from public.org_members where id = p_member_id
  ),
  candidates as (
    select u.id, u.name, u.email
    from public.sf_users_raw u, me
    where u.isactive
      -- Integration and guest accounts are not people and reuse real addresses.
      and u.email not like '%@00d%' and u.email not like 'noreply@%'
      and u.name not ilike '%site guest user%' and u.name not ilike '%integration%'
      and u.name not ilike 'automated%' and u.name not ilike 'security user'
      and u.name not ilike 'system' and u.name not ilike 'data.com%'
  )
  select c.id, c.name, c.email,
         round(greatest(
           case when lower(c.email) = me.email then 1.0 else 0 end,
           similarity(lower(c.name), me.name),
           similarity(lower(c.name), me.email_as_name),
           similarity(replace(split_part(lower(c.email), '@', 1), '.', ' '), me.email_as_name)
         )::numeric, 3) as score,
         case
           when lower(c.email) = me.email then 'same email'
           when similarity(lower(c.name), me.name) >= 0.75 then 'name'
           when similarity(lower(c.name), me.email_as_name) >= 0.6 then 'name vs address'
           else 'weak'
         end as basis
  from candidates c, me
  where greatest(
          case when lower(c.email) = me.email then 1.0 else 0 end,
          similarity(lower(c.name), me.name),
          similarity(lower(c.name), me.email_as_name),
          similarity(replace(split_part(lower(c.email), '@', 1), '.', ' '), me.email_as_name)
        ) >= 0.35
  order by score desc
  limit 5;
$$;

-- Everyone still unlinked, with their best candidate.
-- Note the domain gate is inline, so an admin session querying this directly
-- (no JWT email) sees nothing -- query the function instead.
create or replace view public.org_salesforce_match_review as
select m.id as member_id, m.full_name, m.email,
       s.salesforce_user_id, s.sf_name, s.sf_email, s.score, s.basis
from public.org_members m
left join lateral (select * from public.suggest_salesforce_matches(m.id) limit 1) s on true
where m.active and m.salesforce_user_id is null and public.is_factur_user();
