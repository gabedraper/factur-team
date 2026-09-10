/*
 * Date filters that an index can serve.
 *
 * The first cut wrote `col::date = '2026-09-10'` and `date_trunc('year',
 * col::date) = date_trunc('year', current_date)`. Both are correct and both
 * cast or wrap the column, which means the planner cannot use an index on
 * it and reads every row -- 781,633 of them on opportunities, which is a
 * statement timeout rather than a report.
 *
 * Every date operator is now a half-open range on the bare column:
 * `col >= start and col < end`. A date column compares to a date; a
 * timestamp column promotes the date to midnight in the session's zone.
 * Same answers, index-friendly.
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

  if p_kind in ('date', 'datetime') then
    /* Relative periods: the value is in the operator's name. */
    if p_op = 'this_week' then
      return format('(%s >= date_trunc(''week'', current_date)::date and %s < date_trunc(''week'', current_date)::date + 7)', p_expr, p_expr);
    elsif p_op = 'this_month' then
      return format('(%s >= date_trunc(''month'', current_date)::date and %s < (date_trunc(''month'', current_date) + interval ''1 month'')::date)', p_expr, p_expr);
    elsif p_op = 'last_month' then
      return format('(%s >= (date_trunc(''month'', current_date) - interval ''1 month'')::date and %s < date_trunc(''month'', current_date)::date)', p_expr, p_expr);
    elsif p_op = 'this_quarter' then
      return format('(%s >= date_trunc(''quarter'', current_date)::date and %s < (date_trunc(''quarter'', current_date) + interval ''3 months'')::date)', p_expr, p_expr);
    elsif p_op = 'this_year' then
      return format('(%s >= date_trunc(''year'', current_date)::date and %s < (date_trunc(''year'', current_date) + interval ''1 year'')::date)', p_expr, p_expr);
    elsif p_op = 'last_year' then
      return format('(%s >= (date_trunc(''year'', current_date) - interval ''1 year'')::date and %s < date_trunc(''year'', current_date)::date)', p_expr, p_expr);
    end if;

    if v is null or v = '' then raise exception 'A filter is missing its value'; end if;

    if p_op in ('last_n_days', 'next_n_days') and v !~ '^\d{1,4}$' then
      raise exception '% needs a whole number of days', p_op;
    end if;

    if p_op = 'on' then return format('(%s >= %L::date and %s < %L::date + 1)', p_expr, v, p_expr, v);
    elsif p_op = 'before' then return format('%s < %L::date', p_expr, v);
    elsif p_op = 'after' then return format('%s >= %L::date + 1', p_expr, v);
    elsif p_op = 'on_or_before' then return format('%s < %L::date + 1', p_expr, v);
    elsif p_op = 'on_or_after' then return format('%s >= %L::date', p_expr, v);
    elsif p_op = 'between' then
      parts := string_to_array(v, ',');
      if array_length(parts, 1) <> 2 then raise exception 'Between needs two dates, separated by a comma'; end if;
      return format('(%s >= %L::date and %s < %L::date + 1)', p_expr, trim(parts[1]), p_expr, trim(parts[2]));
    elsif p_op = 'last_n_days' then
      return format('%s >= current_date - %s', p_expr, v::int);
    elsif p_op = 'next_n_days' then
      return format('(%s >= current_date and %s < current_date + %s + 1)', p_expr, p_expr, v::int);
    end if;
    raise exception 'Unknown filter % for a date field', p_op;
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

  raise exception 'Cannot filter on this field';
end;
$$;
