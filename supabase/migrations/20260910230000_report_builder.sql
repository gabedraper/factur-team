/*
 * The report builder: any readable table, any fields, filtered, grouped and
 * summed, saved, shared, charted.
 *
 * Three functions do the work, and all three run as the person asking
 * (security invoker), so row security decides what each report shows. There
 * is no second permission model: if you can read a row through the app, you
 * can report on it, and if you cannot, the report cannot see it either.
 *
 *   report_objects()   what exists -- tables, views, their columns, and the
 *                      foreign keys that let a report show a client's name
 *                      instead of its id.
 *   run_report(spec)   runs one report. The spec is data (field names,
 *                      operator names, values), never SQL. Every name in it
 *                      is checked against information_schema before it is
 *                      quoted into a query with format(), so a spec naming a
 *                      column that does not exist fails loudly, and nothing
 *                      typed into a filter box becomes a query fragment.
 *   report_field_values(...)  distinct values for a filter picker.
 *
 * Saved reports and dashboards follow the saved-views model: private to
 * the author or shared with everyone, and a shared one is edited only by
 * its author or by org.manage.
 */

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  owner_member_id  uuid not null references public.org_members(id) on delete cascade,
  shared           boolean not null default false,
  /* The query: object, columns, filters, groups, aggregates, sort. */
  spec             jsonb not null,
  /* How to draw it: type, which output columns feed the axes. Null = table. */
  chart            jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists reports_owner_idx on public.reports (owner_member_id);

create table if not exists public.dashboards (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  owner_member_id  uuid not null references public.org_members(id) on delete cascade,
  shared           boolean not null default false,
  /* [{ report_id, width: 'third'|'half'|'full', title? }] in display order. */
  tiles            jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists dashboards_owner_idx on public.dashboards (owner_member_id);

alter table public.reports enable row level security;
alter table public.dashboards enable row level security;

/*
 * Read: shared, plus your own. Insert: as yourself. Update and delete: your
 * own, or a shared one with org.manage -- a report everyone sees is company
 * furniture, not something rearranged by whoever opened it last.
 */
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports
  for select to authenticated
  using (
    public.is_factur_user()
    and (shared or owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    ))
  );

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
  );

drop policy if exists reports_write on public.reports;
create policy reports_write on public.reports
  for update to authenticated
  using (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
    or (shared and public.has_permission('org.manage'))
  );

drop policy if exists reports_delete on public.reports;
create policy reports_delete on public.reports
  for delete to authenticated
  using (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
    or (shared and public.has_permission('org.manage'))
  );

drop policy if exists dashboards_read on public.dashboards;
create policy dashboards_read on public.dashboards
  for select to authenticated
  using (
    public.is_factur_user()
    and (shared or owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    ))
  );

drop policy if exists dashboards_insert on public.dashboards;
create policy dashboards_insert on public.dashboards
  for insert to authenticated
  with check (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
  );

drop policy if exists dashboards_write on public.dashboards;
create policy dashboards_write on public.dashboards
  for update to authenticated
  using (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
    or (shared and public.has_permission('org.manage'))
  );

drop policy if exists dashboards_delete on public.dashboards;
create policy dashboards_delete on public.dashboards
  for delete to authenticated
  using (
    owner_member_id = (
      select id from public.org_members where active and auth_user_id = auth.uid() limit 1
    )
    or (shared and public.has_permission('org.manage'))
  );

revoke all on table public.reports, public.dashboards from public, anon;
grant select, insert, update, delete on table public.reports, public.dashboards to authenticated;

-- ---------------------------------------------------------------------------
-- Metadata
-- ---------------------------------------------------------------------------

/*
 * Which tables a report may be built on. Everything readable, except the
 * app's own plumbing: sync state, secrets, backups, the report tables
 * themselves. Row security still applies to everything that is allowed;
 * this list only keeps noise out of the picker.
 */
create or replace function public.report_object_allowed(p_name text)
returns boolean
language sql immutable parallel safe
as $$
  select p_name not in (
      'app_settings', 'security_seal_log', 'staging_sync_watermark', 'uptime_checks',
      'lms_initial_roles', 'list_views', 'list_view_prefs', 'reports', 'dashboards',
      'page_views', 'voice_numbers', 'dialpad_numbers', 'ingest_runs', 'work_sync_runs',
      'timeline_summary_state', 'handbook_passages', 'tal_integrations', 'tal_settings'
    )
    and p_name not like 'gaib\_%'
    and p_name not like '%\_tracking\_store'
    and p_name not like '%\_backup\_%'
    and p_name not like 'salesforce\_sync\_%';
$$;

/* Postgres types folded into the handful a filter box needs to know about. */
create or replace function public.report_kind(p_data_type text)
returns text
language sql immutable parallel safe
as $$
  select case
    when p_data_type in ('text', 'character varying', 'character') then 'text'
    when p_data_type = 'uuid' then 'uuid'
    when p_data_type in ('integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real') then 'number'
    when p_data_type = 'date' then 'date'
    when p_data_type like 'timestamp%' then 'datetime'
    when p_data_type = 'boolean' then 'boolean'
    when p_data_type in ('json', 'jsonb') then 'json'
    when p_data_type = 'ARRAY' then 'array'
    else null
  end;
$$;

/*
 * Single-column foreign keys, which are what let a report show the client's
 * name rather than client_id. Composite keys are left out: there is no single
 * column to join on.
 */
create or replace view public.report_foreign_keys as
  select kcu.table_name, kcu.column_name, ccu.table_name as ref_table, ccu.column_name as ref_column
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    and (select count(*) from information_schema.key_column_usage k2
         where k2.constraint_name = tc.constraint_name and k2.constraint_schema = tc.constraint_schema) = 1;

create or replace function public.report_objects()
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  with labels as (
    /* The column a lookup shows by default: name, then the usual suspects. */
    select table_name,
           (array_agg(column_name order by
              case column_name
                when 'name' then 1 when 'full_name' then 2 when 'display_name' then 3
                when 'title' then 4 when 'label' then 5 when 'email' then 6
                when 'subject' then 7 else 9 end,
              ordinal_position))[1] as label_column
    from information_schema.columns
    where table_schema = 'public' and data_type in ('text', 'character varying')
    group by table_name
  ),
  objs as (
    select t.table_name, t.table_type, coalesce(s.n_live_tup, 0)::bigint as rows_estimate
    from information_schema.tables t
    left join pg_stat_user_tables s on s.schemaname = 'public' and s.relname = t.table_name
    where t.table_schema = 'public'
      and t.table_type in ('BASE TABLE', 'VIEW')
      and public.report_object_allowed(t.table_name)
      and has_table_privilege(format('public.%I', t.table_name), 'SELECT')
  ),
  cols as (
    select c.table_name, c.column_name, c.ordinal_position,
           public.report_kind(c.data_type) as kind,
           case
             when f.ref_table is not null
              and public.report_object_allowed(f.ref_table)
              and has_table_privilege(format('public.%I', f.ref_table), 'SELECT')
             then jsonb_build_object('table', f.ref_table, 'column', f.ref_column, 'label', l.label_column)
           end as lookup
    from information_schema.columns c
    left join public.report_foreign_keys f on f.table_name = c.table_name and f.column_name = c.column_name
    left join labels l on l.table_name = f.ref_table
    where c.table_schema = 'public'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', o.table_name,
    'kind', case when o.table_type = 'VIEW' then 'view' else 'table' end,
    'rows', o.rows_estimate,
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.column_name, 'kind', c.kind, 'lookup', c.lookup)
                                order by c.ordinal_position), '[]'::jsonb)
      from cols c where c.table_name = o.table_name and c.kind is not null
    )
  ) order by o.table_name), '[]'::jsonb)
  from objs o;
$$;

-- ---------------------------------------------------------------------------
-- Resolving a field reference to SQL
-- ---------------------------------------------------------------------------

/*
 * One field, as a quoted expression on the base table `t` or on a lookup
 * join. Raises if the object, field or lookup does not exist, which is the
 * only way a bad name gets anywhere near a query.
 */
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

  select public.report_kind(c.data_type) into v_kind
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_object and c.column_name = p_field;

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

  select public.report_kind(c.data_type) into v_lkind
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = v_ref_table and c.column_name = p_lookup;

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

/*
 * One filter as a SQL condition. Values arrive through format('%L'), so they
 * are literals however they are spelled; the operator is looked up here and
 * an unknown one raises rather than passing through.
 */
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
    elsif p_op = 'this_week' then return format('date_trunc(''week'', %s::date) = date_trunc(''week'', current_date)', p_expr);
    elsif p_op = 'this_month' then return format('date_trunc(''month'', %s::date) = date_trunc(''month'', current_date)', p_expr);
    elsif p_op = 'last_month' then return format('date_trunc(''month'', %s::date) = date_trunc(''month'', current_date) - interval ''1 month''', p_expr);
    elsif p_op = 'this_quarter' then return format('date_trunc(''quarter'', %s::date) = date_trunc(''quarter'', current_date)', p_expr);
    elsif p_op = 'this_year' then return format('date_trunc(''year'', %s::date) = date_trunc(''year'', current_date)', p_expr);
    elsif p_op = 'last_year' then return format('date_trunc(''year'', %s::date) = date_trunc(''year'', current_date) - interval ''1 year''', p_expr);
    end if;
    raise exception 'Unknown filter % for a date field', p_op;
  end if;

  raise exception 'Cannot filter on this field';
end;
$$;

-- ---------------------------------------------------------------------------
-- Running a report
-- ---------------------------------------------------------------------------

create or replace function public.run_report(p_spec jsonb)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  v_object   text := p_spec->>'object';
  v_logic    text := lower(coalesce(p_spec->>'logic', 'and'));
  v_limit    int  := least(greatest(coalesce((p_spec->>'limit')::int, 1000), 1), 5000);
  v_groups   jsonb := coalesce(p_spec->'groups', '[]'::jsonb);
  v_aggs     jsonb := coalesce(p_spec->'aggregates', '[]'::jsonb);
  v_grouped  boolean;
  v_joins    text[] := '{}';
  v_select   text[] := '{}';
  v_where    text[] := '{}';
  v_group    text[] := '{}';
  v_order    text[] := '{}';
  v_keys     text[] := '{}';
  v_exprs    text[] := '{}';
  v_cols     jsonb := '[]'::jsonb;
  v_first_agg text;
  item       jsonb;
  r          record;
  v_expr     text;
  v_key      text;
  v_kind     text;
  v_fn       text;
  v_bucket   text;
  v_idx      int;
  v_sql      text;
  v_result   jsonb;
begin
  if v_object is null or not public.report_object_allowed(v_object)
     or not exists (select 1 from information_schema.tables
                    where table_schema = 'public' and table_name = v_object) then
    raise exception 'Unknown object %', coalesce(v_object, '(none)');
  end if;
  if v_logic not in ('and', 'or') then v_logic := 'and'; end if;

  v_grouped := jsonb_array_length(v_groups) > 0 or jsonb_array_length(v_aggs) > 0;

  if not v_grouped then
    /* A detail report: the chosen columns, one row per record. */
    for item in select * from jsonb_array_elements(coalesce(p_spec->'columns', '[]'::jsonb)) loop
      select * into r from public.report_expr(v_object, item->>'field', item->>'lookup');
      if r.join_sql is not null and not (r.join_sql = any(v_joins)) then v_joins := v_joins || r.join_sql; end if;
      if r.key = any(v_keys) then continue; end if;
      v_select := v_select || format('%s as %I', r.expr, r.key);
      v_keys := v_keys || r.key;
      v_exprs := v_exprs || r.expr;
      v_cols := v_cols || jsonb_build_object('key', r.key, 'kind', r.kind,
                                             'field', item->>'field', 'lookup', item->>'lookup');
    end loop;
    if array_length(v_select, 1) is null then
      raise exception 'Choose at least one column';
    end if;
  else
    /* A summary report: one row per group, with the measures. */
    for item in select * from jsonb_array_elements(v_groups) loop
      select * into r from public.report_expr(v_object, item->>'field', item->>'lookup');
      if r.join_sql is not null and not (r.join_sql = any(v_joins)) then v_joins := v_joins || r.join_sql; end if;
      v_expr := r.expr; v_key := r.key; v_kind := r.kind;
      v_bucket := item->>'bucket';
      if v_bucket is not null and v_bucket <> '' then
        if r.kind not in ('date', 'datetime') then
          raise exception 'Only a date can be grouped by %', v_bucket;
        end if;
        if v_bucket not in ('day', 'week', 'month', 'quarter', 'year') then
          raise exception 'Unknown period %', v_bucket;
        end if;
        v_expr := format('date_trunc(%L, %s)::date', v_bucket, r.expr);
        v_key := r.key || '__' || v_bucket;
        v_kind := 'date';
      end if;
      if v_key = any(v_keys) then continue; end if;
      v_select := v_select || format('%s as %I', v_expr, v_key);
      v_group := v_group || v_expr;
      v_keys := v_keys || v_key;
      v_exprs := v_exprs || v_expr;
      v_cols := v_cols || jsonb_build_object('key', v_key, 'kind', v_kind, 'field', item->>'field',
                                             'lookup', item->>'lookup', 'bucket', v_bucket);
    end loop;

    /* Groups with no measure count the rows, which is what anyone meant. */
    if jsonb_array_length(v_aggs) = 0 then
      v_aggs := '[{"fn": "count"}]'::jsonb;
    end if;

    for item in select * from jsonb_array_elements(v_aggs) loop
      v_fn := lower(item->>'fn');
      if v_fn = 'count' then
        v_expr := 'count(*)'; v_key := 'count'; v_kind := 'number';
      else
        select * into r from public.report_expr(v_object, item->>'field', item->>'lookup');
        if r.join_sql is not null and not (r.join_sql = any(v_joins)) then v_joins := v_joins || r.join_sql; end if;
        if v_fn = 'count_distinct' then
          v_expr := format('count(distinct %s)', r.expr); v_kind := 'number';
        elsif v_fn in ('sum', 'avg') then
          if r.kind <> 'number' then raise exception '% needs a number field', v_fn; end if;
          v_expr := format('%s(%s)', v_fn, r.expr); v_kind := 'number';
        elsif v_fn in ('min', 'max') then
          if r.kind not in ('number', 'date', 'datetime', 'text') then
            raise exception '% needs a number, date or text field', v_fn;
          end if;
          v_expr := format('%s(%s)', v_fn, r.expr); v_kind := r.kind;
        else
          raise exception 'Unknown measure %', v_fn;
        end if;
        v_key := v_fn || '__' || r.key;
      end if;
      if v_key = any(v_keys) then continue; end if;
      if v_first_agg is null then v_first_agg := v_expr; end if;
      v_select := v_select || format('%s as %I', v_expr, v_key);
      v_keys := v_keys || v_key;
      v_exprs := v_exprs || v_expr;
      v_cols := v_cols || jsonb_build_object('key', v_key, 'kind', v_kind, 'fn', v_fn,
                                             'field', item->>'field', 'lookup', item->>'lookup');
    end loop;
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_spec->'filters', '[]'::jsonb)) loop
    select * into r from public.report_expr(v_object, item->>'field', item->>'lookup');
    if r.join_sql is not null and not (r.join_sql = any(v_joins)) then v_joins := v_joins || r.join_sql; end if;
    v_where := v_where || public.report_condition(r.expr, r.kind, item->>'op', item->>'value');
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_spec->'sort', '[]'::jsonb)) loop
    v_idx := array_position(v_keys, item->>'key');
    if v_idx is null then continue; end if;
    v_order := v_order || format('%s %s nulls last', v_exprs[v_idx],
                                 case when lower(item->>'dir') = 'desc' then 'desc' else 'asc' end);
  end loop;
  if array_length(v_order, 1) is null and v_first_agg is not null then
    v_order := array[format('%s desc nulls last', v_first_agg)];
  end if;

  v_sql := format(
    'select %s, count(*) over () as __total from public.%I t %s %s %s %s limit %s',
    array_to_string(v_select, ', '),
    v_object,
    array_to_string(v_joins, ' '),
    case when array_length(v_where, 1) is null then ''
         else 'where ' || array_to_string(v_where, ' ' || v_logic || ' ') end,
    case when array_length(v_group, 1) is null then ''
         else 'group by ' || array_to_string(v_group, ', ') end,
    case when array_length(v_order, 1) is null then ''
         else 'order by ' || array_to_string(v_order, ', ') end,
    v_limit
  );

  execute format(
    'with q as (%s) select jsonb_build_object(''rows'', coalesce(jsonb_agg(to_jsonb(q) - ''__total''), ''[]''::jsonb), ''total'', coalesce(max(q.__total), 0)) from q',
    v_sql
  ) into v_result;

  return v_result || jsonb_build_object(
    'columns', v_cols,
    'limit', v_limit,
    'truncated', coalesce((v_result->>'total')::int, 0) > v_limit
  );
end;
$$;

/*
 * The values a field takes, most common first, for a filter picker. Capped
 * at a hundred; a field with more distinct values than that is a search box,
 * not a list.
 */
create or replace function public.report_field_values(
  p_object text, p_field text, p_lookup text default null, p_query text default null, p_limit int default 50
)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_sql text;
  v_result jsonb;
  esc text;
begin
  if p_object is null or not public.report_object_allowed(p_object)
     or not exists (select 1 from information_schema.tables
                    where table_schema = 'public' and table_name = p_object) then
    raise exception 'Unknown object %', coalesce(p_object, '(none)');
  end if;

  select * into r from public.report_expr(p_object, p_field, p_lookup);
  if r.kind not in ('text', 'uuid', 'number', 'boolean') then
    raise exception 'No value list for this field';
  end if;

  esc := replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_');

  v_sql := format(
    'select %s::text as value, count(*) as n from public.%I t %s where %s is not null %s group by 1 order by n desc, 1 limit %s',
    r.expr, p_object, coalesce(r.join_sql, ''), r.expr,
    case when esc = '' then '' else format('and %s::text ilike %L', r.expr, '%' || esc || '%') end,
    least(greatest(coalesce(p_limit, 50), 1), 100)
  );

  execute format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s) q', v_sql) into v_result;
  return v_result;
end;
$$;

revoke all on function public.report_objects() from public, anon;
revoke all on function public.run_report(jsonb) from public, anon;
revoke all on function public.report_field_values(text, text, text, text, int) from public, anon;
revoke all on function public.report_expr(text, text, text) from public, anon;
revoke all on function public.report_condition(text, text, text, text) from public, anon;
grant execute on function public.report_objects() to authenticated;
grant execute on function public.run_report(jsonb) to authenticated;
grant execute on function public.report_field_values(text, text, text, text, int) to authenticated;
grant execute on function public.report_expr(text, text, text) to authenticated;
grant execute on function public.report_condition(text, text, text, text) to authenticated;
revoke all on public.report_foreign_keys from public, anon;
grant select on public.report_foreign_keys to authenticated;
