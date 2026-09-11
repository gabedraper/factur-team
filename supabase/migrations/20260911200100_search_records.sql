/*
 * The header search: one object at a time, across every record the caller can
 * see, whatever view they happen to have open.
 *
 * One object per call rather than everything in one query, so "All" runs the
 * five as parallel requests and a narrow search (just Contacts) pays for one.
 *
 * SECURITY DEFINER, and it has to be -- which means it applies visibility
 * itself, and those checks are the part of this file that matters most.
 *
 * Under row level security a LIKE can never use an index. Postgres will not
 * run a caller's condition ahead of the policy unless the operator is marked
 * leakproof, and the text LIKE operator is not; so every search read all
 * 780,000 opportunities and took over a second, trigram index or no. (Equals
 * is leakproof, which is why the picklist filters could be fixed with a btree.)
 * Only a superuser can change that marking, and Supabase gives us none.
 *
 * So the policies are restated here, word for word, and must be kept in step
 * with them:
 *
 *   opportunities   is_factur_user() and (has_permission('org.manage')
 *                   or client_id in my_client_ids())   -- opportunities_scoped
 *   crm_contacts,
 *   crm_accounts,
 *   org_clients     is_factur_user()
 *   tal_people      tal_can_view()
 *
 * Contacts and companies are further narrowed to ones a visible opportunity
 * points at -- what makes them "target" contacts and companies, as on the
 * lists, rather than the whole 1.8M-row CRM. Every helper above reads the
 * caller's own JWT (auth.uid(), auth.jwt()), which a definer function still
 * sees, so the answer is the caller's and not this function owner's.
 *
 * Matching: the longest word goes to the trigram index (the expressions here
 * are character-for-character the ones in 20260911200000, or the planner will
 * not use them), and every other word is checked on the rows that come back.
 * So "smith john" finds John Smith, and a one-letter initial does not force a
 * scan. A query that is mostly digits is a phone number, and matches contacts'
 * phones digits-to-digits regardless of how either was punctuated.
 *
 * Returns p_limit + 1 rows at most, so the caller can say "50+" without a
 * count -- counting every match costs more than the page it labels.
 *
 * Every branch is RETURN QUERY EXECUTE, not plain SQL. PL/pgSQL caches a
 * generic plan after a handful of calls, and a generic plan for "like <some
 * text>" cannot know whether the text is "a" or "mcfarland" -- it may well pick
 * a scan. EXECUTE plans each call with the real words. The strings are fixed;
 * nothing the user typed is spliced into them, it all arrives through USING.
 */

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
       where ($6 or o.client_id = any($7))
         and lower(coalesce(o.name, '')) like $1
         and not exists (
           select 1 from unnest($3[2:]) w
            where strpos(lower(coalesce(o.name, '')), w) = 0
         )
       order by lower(coalesce(o.name, '')) like $2 desc,
                o.updated_at desc nulls last
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients;

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
             and ($6 or o.client_id = any($7))
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
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients;

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
             and ($6 or o.client_id = any($7))
           order by o.updated_at desc nulls last
           limit 1
        ) best
        left join public.crm_accounts a on a.id = k.account_id
        left join public.org_clients c on c.id = best.client_id
       where $5::text is not null
         and regexp_replace(coalesce(k.phone, ''), '\D', '', 'g') like '%' || $5 || '%'
       order by k.last_name nulls last, k.first_name
       limit $4
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients;

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
             and ($6 or o.client_id = any($7))
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
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients;

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
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients;

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
    $sql$ using v_pat, v_prefix, v_words, v_limit, v_digits, v_all, v_clients;
  end if;
end;
$$;

revoke all on function public.search_records(text, text, integer) from public, anon;
grant execute on function public.search_records(text, text, integer) to authenticated;
