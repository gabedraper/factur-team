/*
 * Picklist filters use equals, and existing ones are converted.
 *
 * A view filtering "Lead status contains Pipeline - Warm" took 4,087ms and
 * timed out behind the API's 8 second limit. The same view with equals takes
 * 7.9ms. Five hundred times, and none of it is about how much data there is.
 *
 * ilike '%...%' cannot seek an index, so the planner scanned all 53,007 rows of
 * that client, then joined the contact and the company for all 1,909 matches,
 * and only then sorted and took fifty. With equals it seeks straight into
 * (client_id, lead_status), walks out fifty rows already in order, and joins
 * fifty contacts instead of nineteen hundred.
 *
 * Stage and lead status are picklists -- closed sets of exact strings chosen
 * from a dropdown. "Contains" was never the right operator for one, it was just
 * the first in a list written for free text. It is gone for these two fields,
 * which is also what Salesforce offers.
 *
 * Existing filters are rewritten rather than dropped. A saved view holding an
 * operator the catalogue no longer allows would silently lose that filter and
 * quietly turn into "everything", which is the slow thing this is fixing.
 */

update public.opportunity_list_views v
set filters = (
  select jsonb_agg(
    case
      when f->>'field' in ('stage', 'lead_status') and f->>'op' in ('contains', 'starts_with')
        then jsonb_set(f, '{op}', '"equals"')
      when f->>'field' in ('stage', 'lead_status') and f->>'op' in ('not_contains', 'not_starts_with')
        then jsonb_set(f, '{op}', '"not_equals"')
      else f
    end
    order by ord
  )
  from jsonb_array_elements(v.filters) with ordinality as t(f, ord)
)
where exists (
  select 1 from jsonb_array_elements(v.filters) as f
  where f->>'field' in ('stage', 'lead_status')
    and f->>'op' in ('contains', 'not_contains', 'starts_with', 'not_starts_with')
);
