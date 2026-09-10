/*
 * The foreign-key view becomes a function.
 *
 * PostgREST introspects every view in the exposed schema to work out which
 * base-table columns each view column comes from, so embedding through a
 * view can work. For a view over pg_catalog that introspection ran past the
 * statement timeout, the schema cache never loaded, and the whole REST API
 * answered PGRST002 -- for everyone, from the moment the view appeared.
 *
 * A function is not introspected that way. Same query, same answers.
 */

drop view if exists public.report_foreign_keys;

create or replace function public.report_foreign_keys()
returns table(table_name text, column_name text, ref_table text, ref_column text)
language sql stable
set search_path = public, pg_catalog
as $$
  select cl.relname::text, a.attname::text, rcl.relname::text, ra.attname::text
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join pg_class rcl on rcl.oid = con.confrelid
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
  join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = con.confkey[1]
  where con.contype = 'f'
    and n.nspname = 'public'
    and array_length(con.conkey, 1) = 1;
$$;

create or replace function public.report_objects()
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  with rels as (
    select c.oid, c.relname::text as table_name,
           case when c.relkind in ('v', 'm') then 'view' else 'table' end as kind,
           coalesce(s.n_live_tup, 0)::bigint as rows_estimate
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and public.report_object_allowed(c.relname::text)
      and has_table_privilege(c.oid, 'SELECT')
  ),
  labels as (
    select a.attrelid,
           (array_agg(a.attname::text order by
              case a.attname::text
                when 'name' then 1 when 'full_name' then 2 when 'display_name' then 3
                when 'title' then 4 when 'label' then 5 when 'email' then 6
                when 'subject' then 7 else 9 end,
              a.attnum))[1] as label_column
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    where a.attnum > 0 and not a.attisdropped
      and t.typname in ('text', 'varchar', 'bpchar')
    group by a.attrelid
  ),
  fks as (select * from public.report_foreign_keys()),
  cols as (
    select a.attrelid, a.attname::text as column_name, a.attnum,
           public.report_kind(public.report_type_name(a.atttypid, a.atttypmod)) as kind,
           case
             when rr.oid is not null then
               jsonb_build_object('table', f.ref_table, 'column', f.ref_column, 'label', l.label_column)
           end as lookup
    from pg_attribute a
    join rels r on r.oid = a.attrelid
    left join fks f on f.table_name = r.table_name and f.column_name = a.attname::text
    left join rels rr on rr.table_name = f.ref_table
    left join labels l on l.attrelid = rr.oid
    where a.attnum > 0 and not a.attisdropped
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', r.table_name,
    'kind', r.kind,
    'rows', r.rows_estimate,
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.column_name, 'kind', c.kind, 'lookup', c.lookup)
                                order by c.attnum), '[]'::jsonb)
      from cols c where c.attrelid = r.oid and c.kind is not null
    )
  ) order by r.table_name), '[]'::jsonb)
  from rels r;
$$;

create or replace function public.report_expr(p_object text, p_field text, p_lookup text)
returns table(expr text, kind text, key text, join_sql text)
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  v_kind text;
  v_ref_table text;
  v_ref_column text;
  v_alias text;
  v_lkind text;
begin
  if p_field is null then
    raise exception 'A field is missing';
  end if;

  v_kind := public.report_column_kind(p_object, p_field);
  if v_kind is null then
    raise exception 'Unknown field % on %', p_field, p_object;
  end if;

  if p_lookup is null or p_lookup = '' then
    return query select format('t.%I', p_field), v_kind, p_field, null::text;
    return;
  end if;

  select f.ref_table, f.ref_column into v_ref_table, v_ref_column
  from public.report_foreign_keys() f
  where f.table_name = p_object and f.column_name = p_field;

  if v_ref_table is null then
    raise exception '% on % is not a lookup', p_field, p_object;
  end if;
  if not public.report_object_allowed(v_ref_table) then
    raise exception '% is not reportable', v_ref_table;
  end if;

  v_lkind := public.report_column_kind(v_ref_table, p_lookup);
  if v_lkind is null then
    raise exception 'Unknown field % on %', p_lookup, v_ref_table;
  end if;

  v_alias := 'l_' || p_field;
  return query select
    format('%I.%I', v_alias, p_lookup),
    v_lkind,
    p_field || '__' || p_lookup,
    format('left join public.%I %I on %I.%I = t.%I', v_ref_table, v_alias, v_alias, v_ref_column, p_field);
end;
$$;

revoke all on function public.report_foreign_keys() from public, anon;
grant execute on function public.report_foreign_keys() to authenticated;
