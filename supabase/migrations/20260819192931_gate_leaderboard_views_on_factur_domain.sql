-- The leaderboard views and the hustle RPC run with the creator's privileges,
-- which is deliberate: they must read across every rep's activity, and
-- raw_activities is row-restricted to the viewer's own rows. That also meant
-- they answered any signed-in Google account, not just Factur staff.
--
-- Keep the privilege escalation (the leaderboards need it) but add an explicit
-- domain gate, so a non-Factur session gets zero rows instead of the company's
-- numbers. Definitions are otherwise byte-for-byte the originals.

create or replace view public.daily_leaderboard as
 SELECT r.id AS rep_id,
    r.display_name,
    r.email,
    ra.activity_date,
    COALESCE(sum(ew.points), 0::numeric) AS total_points,
    COALESCE(sum(ew.points) FILTER (WHERE ra.effort_source = ANY (ARRAY['Manual Call'::text, 'Manual SMS'::text, 'Client Meeting (Check-In)'::text, 'Prospect Meeting'::text])), 0::numeric) AS manual_points,
    COALESCE(sum(ew.points) FILTER (WHERE ra.effort_source = ANY (ARRAY['Automated Call (Power Dialer)'::text, 'Sequence Email (Automated Send)'::text])), 0::numeric) AS automated_points
   FROM reps r
     JOIN raw_activities ra ON ra.salesforce_owner_id = r.salesforce_owner_id
     JOIN effort_weights ew ON ew.effort_source = ra.effort_source
  WHERE r.active = true AND public.is_factur_user()
  GROUP BY r.id, r.display_name, r.email, ra.activity_date;

create or replace view public.daily_leaderboard_by_source as
 SELECT r.id AS rep_id,
    r.display_name,
    r.email,
    ra.activity_date,
    ra.effort_source,
    count(*) FILTER (WHERE ra.is_dedup_primary) AS activity_count,
    count(*) FILTER (WHERE ra.is_dedup_primary)::numeric * max(ew.points) AS points
   FROM reps r
     JOIN raw_activities ra ON ra.salesforce_owner_id = r.salesforce_owner_id
     JOIN effort_weights ew ON ew.effort_source = ra.effort_source
  WHERE r.active = true AND public.is_factur_user()
  GROUP BY r.id, r.display_name, r.email, ra.activity_date, ra.effort_source;

create or replace view public.deals_leaderboard as
 SELECT r.id AS rep_id,
    r.display_name,
    da.event_date,
    da.deal_type,
    dw.points
   FROM deal_activities da
     JOIN reps r ON r.salesforce_owner_id = da.salesforce_owner_id
     JOIN deal_weights dw ON dw.deal_type = da.deal_type
  WHERE r.active = true AND public.is_factur_user();

create or replace view public.retention_stats as
 SELECT r.id AS rep_id,
    r.display_name,
    da.event_date,
    da.deal_type
   FROM deal_activities da
     JOIN reps r ON r.salesforce_owner_id = da.salesforce_owner_id
  WHERE (da.deal_type = ANY (ARRAY['Renewed Client'::text, 'Lost Client'::text, 'Early Terminated Client'::text]))
    AND r.active = true AND public.is_factur_user();

create or replace view public.deal_activity_detail as
 SELECT r.id AS rep_id,
    da.event_date,
    da.deal_type,
    da.account_name,
        CASE
            WHEN da.deal_type = 'New Customer PO'::text THEN ('https://factur.lightning.force.com/lightning/r/Order/'::text || da.id) || '/view'::text
            ELSE ('https://factur.lightning.force.com/lightning/r/Opportunity/'::text || regexp_replace(da.id, '-orig-sale'::text, ''::text)) || '/view'::text
        END AS sf_link,
    da.client_name
   FROM deal_activities da
     JOIN reps r ON r.salesforce_owner_id = da.salesforce_owner_id
  WHERE r.active = true AND public.is_factur_user();

create or replace view public.rep_activity_detail as
 SELECT r.id AS rep_id,
    ra.activity_date,
        CASE ra.effort_source
            WHEN 'Manual Call'::text THEN 'Calls'::text
            WHEN 'Automated Call (Power Dialer)'::text THEN 'Calls'::text
            WHEN 'Automated Call (Parallel Dialer)'::text THEN 'Calls'::text
            WHEN 'Manual SMS'::text THEN 'Calls'::text
            WHEN 'Sequence Email (Automated Send)'::text THEN 'Automated Emails'::text
            WHEN 'Manual Email'::text THEN 'Manual Emails'::text
            WHEN 'Internal Meeting'::text THEN 'Internal Meetings'::text
            WHEN 'Client Meeting (Check-In)'::text THEN 'Client Meetings'::text
            WHEN 'Prospect Meeting'::text THEN 'Prospect Meetings'::text
            ELSE NULL::text
        END AS category,
    ra.subject,
    ra.id AS activity_id,
    ra.whoid,
        CASE
            WHEN ra.activity_type = 'Meeting'::text THEN ('https://factur.lightning.force.com/lightning/r/Event/'::text || ra.id) || '/view'::text
            ELSE ('https://factur.lightning.force.com/lightning/r/Task/'::text || ra.id) || '/view'::text
        END AS sf_link
   FROM raw_activities ra
     JOIN reps r ON r.salesforce_owner_id = ra.salesforce_owner_id
  WHERE ra.effort_source = ANY (ARRAY['Manual Call'::text, 'Automated Call (Power Dialer)'::text, 'Automated Call (Parallel Dialer)'::text, 'Manual SMS'::text, 'Sequence Email (Automated Send)'::text, 'Manual Email'::text, 'Internal Meeting'::text, 'Client Meeting (Check-In)'::text, 'Prospect Meeting'::text])
    AND public.is_factur_user();

create or replace function public.get_hustle_leaderboard_by_source(p_start date, p_end date)
 returns table(rep_id uuid, display_name text, effort_source text, activity_count bigint, points numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT
    r.id AS rep_id,
    r.display_name,
    ra.effort_source,
    count(*) FILTER (WHERE ra.is_dedup_primary) AS activity_count,
    count(*) FILTER (WHERE ra.is_dedup_primary) * max(ew.points) AS points
  FROM reps r
  JOIN raw_activities ra ON ra.salesforce_owner_id = r.salesforce_owner_id
  JOIN effort_weights ew ON ew.effort_source = ra.effort_source
  WHERE r.active = true
    AND public.is_factur_user()
    AND ra.activity_date >= p_start
    AND ra.activity_date <= p_end
  GROUP BY r.id, r.display_name, ra.effort_source;
$function$;
