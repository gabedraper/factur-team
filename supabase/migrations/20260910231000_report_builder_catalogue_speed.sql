/*
 * Two fixes to the report builder's first cut, found on first run.
 *
 * report_objects() timed out. It was built on information_schema, whose
 * views (constraint_column_usage above all) are slow enough that describing
 * 212 tables and 3,879 columns ran past the statement timeout. The same
 * questions asked of pg_catalog directly come back in milliseconds, so the
 * catalogue, the foreign-key view and the per-field lookup all move there.
 *
 * report_condition() demanded a value for every operator that was not
 * is_empty / is_not_empty / is_true / is_false -- which included "this
 * month" and its siblings, none of which take one.
 */

/* Dropped rather than replaced: the columns change type from sql_identifier to text. */
drop view if exists public.report_foreign_keys;
create view public.report_foreign_keys as
  select cl.relname::text  as table_name,
         a.attname::text   as column_name,
         rcl.relname::text as ref_table,
         ra.attname::text  as ref_column
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join pg_class rcl on rcl.oid = con.confrelid
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
  join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = con.confkey[1]
  where con.contype = 'f'
    and n.nspname = 'public'
    and array_length(con.conkey, 1) = 1;

/* The information_schema data_type name for a column, from pg_catalog. */
create or replace function public.report_type_name(p_typid oid, p_typmod int)
returns text
language sql stable parallel safe
as $$
  select case
    when t.typcategory = 'A' then 'ARRAY'
    else regexp_replace(format_type(p_typid, p_typmod), '\(.*\)', '')
  end
  from pg_type t where t.oid = p_typid;
$$;

/* The kind of one column, or null when the table or column does not exist. */
create or replace function public.report_column_kind(p_object text, p_field text)
returns text
language sql stable
set search_path = public, pg_catalog
as $$
  select public.report_kind(public.report_type_name(a.atttypid, a.atttypmod))
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = p_object
    and a.attname = p_field
    and a.attnum > 0
    and not a.attisdropped;
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
    /* The column a lookup shows by default: name, then the usual suspects. */
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
  cols as (
    select a.attrelid, a.attname::text as column_name, a.attnum,
           public.report_kind(public.report_type_name(a.atttypid, a.atttypmod)) as kind,
           case
             when rr.oid is not null then
               jsonb_build_object('table', f.ref_table, 'column', f.ref_column, 'label', l.label_column)
           end as lookup
    from pg_attribute a
    join rels r on r.oid = a.attrelid
    left join public.report_foreign_keys f
      on f.table_name = r.table_name and f.column_name = a.attname::text
    /* Only a lookup into a table this person may also read. */
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
  from public.report_foreign_keys f
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

create or replace function public.report_condition(p_expr text, p_kind text, p_op text, p_value text)
returns text
language plpgsql immutable
as $$
declare
  v text := p_value;
  esc text;
  parts text[];
begin
  if p_op is null then raise exception 'A filter has no operator'; end if;

  /* Operators every kind shares. */
  if p_op = 'is_empty' then
    return case
      when p_kind = 'text' then format('(%s is null or %s = '''')', p_expr, p_expr)
      when p_kind = 'array' then format('(%s is null or cardinality(%s) = 0)', p_expr, p_expr)
      else format('%s is null', p_expr) end;
  elsif p_op = 'is_not_empty' then
    return case
      when p_kind = 'text' then format('(%s is not null and %s <> '''')', p_expr, p_expr)
      when p_kind = 'array' then format('(%s is not null and cardinality(%s) > 0)', p_expr, p_expr)
      else format('%s is not null', p_expr) end;
  end if;

  if p_kind = 'boolean' then
    if p_op = 'is_true' then return format('%s is true', p_expr);
    elsif p_op = 'is_false' then return format('%s is false', p_expr);
    end if;
    raise exception 'Unknown filter % for a yes/no field', p_op;
  end if;

  /* The relative-period operators carry their value in their name. */
  if p_kind in ('date', 'datetime') then
    if p_op = 'this_week' then return format('date_trunc(''week'', %s::date) = date_trunc(''week'', current_date)', p_expr);
    elsif p_op = 'this_month' then return format('date_trunc(''month'', %s::date) = date_trunc(''month'', current_date)', p_expr);
    elsif p_op = 'last_month' then return format('date_trunc(''month'', %s::date) = date_trunc(''month'', current_date) - interval ''1 month''', p_expr);
    elsif p_op = 'this_quarter' then return format('date_trunc(''quarter'', %s::date) = date_trunc(''quarter'', current_date)', p_expr);
    elsif p_op = 'this_year' then return format('date_trunc(''year'', %s::date) = date_trunc(''year'', current_date)', p_expr);
    elsif p_op = 'last_year' then return format('date_trunc(''year'', %s::date) = date_trunc(''year'', current_date) - interval ''1 year''', p_expr);
    end if;
  end if;

  if v is null or v = '' then
    raise exception 'A filter is missing its value';
  end if;

  /* Text-like: text and uuid compare as text; json and arrays only search. */
  esc := replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_');

  if p_kind in ('text', 'uuid', 'json') then
    if p_op = 'eq' then return format('%s::text = %L', p_expr, v);
    elsif p_op = 'neq' then return format('%s::text is distinct from %L', p_expr, v);
    elsif p_op = 'contains' then return format('%s::text ilike %L', p_expr, '%' || esc || '%');
    elsif p_op = 'not_contains' then return format('(%s is null or %s::text not ilike %L)', p_expr, p_expr, '%' || esc || '%');
    elsif p_op = 'starts_with' then return format('%s::text ilike %L', p_expr, esc || '%');
    elsif p_op = 'in' then
      parts := array(select trim(x) from unnest(string_to_array(v, ',')) x where trim(x) <> '');
      return format('%s::text = any(%L::text[])', p_expr, parts);
    elsif p_op = 'not_in' then
      parts := array(select trim(x) from unnest(string_to_array(v, ',')) x where trim(x) <> '');
      return format('(%s is null or %s::text <> all(%L::text[]))', p_expr, p_expr, parts);
    end if;
    raise exception 'Unknown filter % for a text field', p_op;
  end if;

  if p_kind = 'array' then
    if p_op = 'contains' then return format('%L = any(%s)', v, p_expr);
    elsif p_op = 'not_contains' then return format('(%s is null or not (%L = any(%s)))', p_expr, v, p_expr);
    end if;
    raise exception 'Unknown filter % for a list field', p_op;
  end if;

  if p_kind = 'number' then
    if p_op = 'eq' then return format('%s = %L::numeric', p_expr, v);
    elsif p_op = 'neq' then return format('%s is distinct from %L::numeric', p_expr, v);
    elsif p_op = 'gt' then return format('%s > %L::numeric', p_expr, v);
    elsif p_op = 'gte' then return format('%s >= %L::numeric', p_expr, v);
    elsif p_op = 'lt' then return format('%s < %L::numeric', p_expr, v);
    elsif p_op = 'lte' then return format('%s <= %L::numeric', p_expr, v);
    elsif p_op = 'between' then
      parts := string_to_array(v, ',');
      if array_length(parts, 1) <> 2 then raise exception 'Between needs two numbers, separated by a comma'; end if;
      return format('%s between %L::numeric and %L::numeric', p_expr, trim(parts[1]), trim(parts[2]));
    end if;
    raise exception 'Unknown filter % for a number field', p_op;
  end if;

  if p_kind in ('date', 'datetime') then
    if p_op = 'on' then return format('%s::date = %L::date', p_expr, v);
    elsif p_op = 'before' then return format('%s::date < %L::date', p_expr, v);
    elsif p_op = 'after' then return format('%s::date > %L::date', p_expr, v);
    elsif p_op = 'on_or_before' then return format('%s::date <= %L::date', p_expr, v);
    elsif p_op = 'on_or_after' then return format('%s::date >= %L::date', p_expr, v);
    elsif p_op = 'between' then
      parts := string_to_array(v, ',');
      if array_length(parts, 1) <> 2 then raise exception 'Between needs two dates, separated by a comma'; end if;
      return format('%s::date between %L::date and %L::date', p_expr, trim(parts[1]), trim(parts[2]));
    elsif p_op = 'last_n_days' then
      if v !~ '^\d{1,4}$' then raise exception 'Last N days needs a whole number'; end if;
      return format('%s::date >= current_date - %s', p_expr, v::int);
    elsif p_op = 'next_n_days' then
      if v !~ '^\d{1,4}$' then raise exception 'Next N days needs a whole number'; end if;
      return format('%s::date between current_date and current_date + %s', p_expr, v::int);
    end if;
    raise exception 'Unknown filter % for a date field', p_op;
  end if;

  raise exception 'Cannot filter on this field';
end;
$$;

revoke all on function public.report_type_name(oid, int) from public, anon;
revoke all on function public.report_column_kind(text, text) from public, anon;
grant execute on function public.report_type_name(oid, int) to authenticated;
grant execute on function public.report_column_kind(text, text) to authenticated;
revoke all on public.report_foreign_keys from public, anon;
grant select on public.report_foreign_keys to authenticated;
