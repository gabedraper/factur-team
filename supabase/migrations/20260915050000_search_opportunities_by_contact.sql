-- Opportunities found by their contact as well as their name.
--
-- Searching a contact's email address found the contact and not the deal,
-- because the opportunity branch only ever matched the opportunity's name.
-- A second statement on the same branch matches the contact's name and email
-- through the trigram index on crm_contacts, then walks to their
-- opportunities -- separate from the name match so each can use its own
-- index. Otherwise identical to 20260915040100.

create or replace function public.search_records(
  p_object text,
  p_q text,
  p_limit integer default 5
)
returns table (
  object text,
  id uuid,
  title text,
  subtitle text,
  opportunity_id uuid,
  client_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q       text := lower(btrim(coalesce(p_q, '')));
  v_words   text[];
  v_key     text;
  v_pat     text;
  v_prefix  text;
  v_digits  text;
  v_limit   integer := greatest(1, least(coalesce(p_limit, 5), 100)) + 1;
  v_all     boolean;
  v_clients uuid[];
  v_owners  uuid[];
begin
  if length(v_q) < 2 or not public.is_factur_user() then
    return;
  end if;
  if p_object = 'person' and not public.tal_can_view() then
    return;
  end if;

  v_all := public.has_permission('org.manage');
  if not v_all then
    select coalesce(array_agg(m.client_id), '{}') into v_clients from public.my_client_ids() m;
    select coalesce(array_agg(c.member_id), '{}') into v_owners from public.my_member_circle() c;
  end if;

  select array_agg(w order by length(w) desc)
    into v_words
    from regexp_split_to_table(v_q, '\s+') as w
   where w <> '';
  v_key := v_words[1];

  -- Escape LIKE's own wildcards: "100%" is a search for those four characters.
  v_pat    := '%' || replace(replace(replace(v_key, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_prefix := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if v_q ~ '^[\d\s().+-]+$' then
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    -- A typed country code should still find a number stored without one.
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then
      v_digits := substr(v_digits, 2);
    end if;
    if length(v_digits) < 4 then
      v_digits := null;
    end if;
  end if;

  /* A two-letter word has no trigrams, and a trigram search with none reads
     the whole index -- seconds on 1.3M companies. Clients and people are small
     enough to scan, so "Li" still finds them; the big three wait for a third
     letter (or a phone number). */
  if p_object in ('opportunity', 'contact', 'company')
     and length(v_key) < 3 and v_digits is null then
    return;
  end if;

  if p_object = 'opportunity' then
    return query execute $sql$
      select 'opportunity'::text, o.id, coalesce(o.name, 'Untitled opportunity'),
             concat_ws(' · ', o.stage, c.name),
             o.id, o.client_id
        from public.opportunities o
        left join public.org_clients c on c.id = o.client_id
       where ($6 or o.client_id = any($7) or o.owner_member_id = any($8))
         and lower(coalesce(o.name, '')) like $1
         and not exists (
           select 1 from unnest($3[2:]) w
            where strpos(lower(coalesce(o.name, '')), w) = 0
         )
       order by lower(coalesce(o.name, '')) like $2 desc,
                o.updated_at desc nulls last
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients, v_owners;

    -- The same deals, reached through the person on them. The contact
    -- expression is character-for-character the one indexed in 20260911200000.
    return query execute $sql$
      select 'opportunity'::text, o.id, coalesce(o.name, 'Untitled opportunity'),
             concat_ws(' · ', o.stage, c.name),
             o.id, o.client_id
        from public.crm_contacts k
        join public.opportunities o on o.contact_id = k.id
        left join public.org_clients c on c.id = o.client_id
       where ($6 or o.client_id = any($7) or o.owner_member_id = any($8))
         and lower(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '') || ' ' || coalesce(k.email, '')) like $1
         and not exists (
           select 1 from unnest($3[2:]) w
            where strpos(lower(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '') || ' ' || coalesce(k.email, '')), w) = 0
         )
         and not (lower(coalesce(o.name, '')) like $1)
       order by o.updated_at desc nulls last
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients, v_owners;

  elsif p_object = 'contact' then
    /* Phone and name are separate statements, not one CASE: an index cannot be
       used on an expression hidden inside a CASE, and each branch has its own. */
    return query execute $sql$
      select 'contact'::text, k.id,
             nullif(btrim(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '')), ''),
             concat_ws(' · ', k.title, a.name, c.name),
             best.id, best.client_id
        from public.crm_contacts k
        -- The contact's most recently touched opportunity that the caller can
        -- see. A contact on no pipeline of theirs produces no row and drops out.
        cross join lateral (
          select o.id, o.client_id
            from public.opportunities o
           where o.contact_id = k.id
             and ($6 or o.client_id = any($7) or o.owner_member_id = any($8))
           order by o.updated_at desc nulls last
           limit 1
        ) best
        left join public.crm_accounts a on a.id = k.account_id
        left join public.org_clients c on c.id = best.client_id
       where $5::text is null
         and lower(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '') || ' ' || coalesce(k.email, '')) like $1
         and not exists (
           select 1 from unnest($3[2:]) w
            where strpos(lower(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '') || ' ' || coalesce(k.email, '')), w) = 0
         )
       order by lower(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '')) like $2 desc,
                k.last_name nulls last, k.first_name
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients, v_owners;

    return query execute $sql$
      select 'contact'::text, k.id,
             nullif(btrim(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '')), ''),
             concat_ws(' · ', k.phone, a.name, c.name),
             best.id, best.client_id
        from public.crm_contacts k
        cross join lateral (
          select o.id, o.client_id
            from public.opportunities o
           where o.contact_id = k.id
             and ($6 or o.client_id = any($7) or o.owner_member_id = any($8))
           order by o.updated_at desc nulls last
           limit 1
        ) best
        left join public.crm_accounts a on a.id = k.account_id
        left join public.org_clients c on c.id = best.client_id
       where $5::text is not null
         and regexp_replace(coalesce(k.phone, ''), '\D', '', 'g') like '%' || $5 || '%'
       order by k.last_name nulls last, k.first_name
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients, v_owners;

  elsif p_object = 'company' then
    return query execute $sql$
      select 'company'::text, a.id, a.name,
             concat_ws(' · ', a.domain, c.name),
             null::uuid, best.client_id
        from public.crm_accounts a
        cross join lateral (
          select o.client_id
            from public.opportunities o
           where o.account_id = a.id
             and ($6 or o.client_id = any($7) or o.owner_member_id = any($8))
           order by o.updated_at desc nulls last
           limit 1
        ) best
        left join public.org_clients c on c.id = best.client_id
       where lower(coalesce(a.name, '') || ' ' || coalesce(a.domain, '')) like $1
         and not exists (
           select 1 from unnest($3[2:]) w
            where strpos(lower(coalesce(a.name, '') || ' ' || coalesce(a.domain, '')), w) = 0
         )
       order by lower(coalesce(a.name, '')) like $2 desc, a.name
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients, v_owners;

  elsif p_object = 'client' then
    return query execute $sql$
      select 'client'::text, c.id, c.name, c.status,
             null::uuid, c.id
        from public.org_clients c
       where lower(coalesce(c.name, '')) like $1
         and not exists (
           select 1 from unnest($3[2:]) w
            where strpos(lower(coalesce(c.name, '')), w) = 0
         )
       order by lower(coalesce(c.name, '')) like $2 desc,
                c.status = 'Active' desc, c.name
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients, v_owners;

  elsif p_object = 'person' then
    return query execute $sql$
      select 'person'::text, p.id, p.name,
             concat_ws(' · ', p.title, p.company_name),
             null::uuid, null::uuid
        from public.tal_people p
       where p.merged_into_id is null
         and lower(coalesce(p.name, '') || ' ' || coalesce(p.primary_email, '') || ' ' || coalesce(p.company_name, '')) like $1
         and not exists (
           select 1 from unnest($3[2:]) w
            where strpos(lower(coalesce(p.name, '') || ' ' || coalesce(p.primary_email, '') || ' ' || coalesce(p.company_name, '')), w) = 0
         )
       order by lower(coalesce(p.name, '')) like $2 desc, p.name
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients, v_owners;
  end if;
end;
$$;

revoke all on function public.search_records(text, text, integer) from public, anon;
grant execute on function public.search_records(text, text, integer) to authenticated;
