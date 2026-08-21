-- classify_activity built regular expressions by splicing client and rep names
-- straight into a pattern. A client called "+vantage Corporation" produced
-- '\y+vantage\y' -- a + quantifier applied to a zero-width assertion, which is
-- not a valid regex. The function raised, refresh_raw_activities() raised, and
-- nightly_maintenance() died with it, so raw_activities stopped updating and
-- every scoreboard read empty for the current day.
--
-- That client is Inactive and had been filtered out of the sync until the client
-- source was widened to all statuses, which is what exposed it. The names were
-- always untrusted input; the sync only changed which ones arrived.

create or replace function public.regex_escape(p_text text)
returns text language sql immutable
set search_path = public, pg_catalog
as $$
  select regexp_replace(coalesce(p_text, ''), '([.^$|()\[\]{}*+?\\-])', '\\\1', 'g');
$$;

comment on function public.regex_escape(text) is
  'Escapes regex metacharacters so a name can be used inside a pattern. Company names contain +, ., ( and - far more often than anyone expects.';

-- classify_activity is recreated with public.regex_escape() wrapped around both
-- places a name is spliced into a pattern: the rep first-name check and the
-- client first-word check.
