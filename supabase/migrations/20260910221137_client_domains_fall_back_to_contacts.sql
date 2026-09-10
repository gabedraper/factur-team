/*
 * A client's domain, falling back to its contacts' email addresses.
 *
 * 82 of 215 live clients had no Email_Domain__c in Salesforce, so their rows
 * showed initials instead of a logo. But the same Salesforce record carries a
 * decision-maker email and a main-contact email, and the client's own contact
 * is on the client's own domain.
 *
 * Precedence is explicit field, then decision maker, then main contact. Where
 * the two contacts disagreed, the decision maker was right in every case --
 * the "main contact" was variously an investor, an outsourced sales firm, and
 * a Gmail address. Free-mail domains are never used; a logo for gmail.com is
 * worse than initials.
 *
 * This changes the function the hourly job already calls rather than
 * backfilling the column, deliberately. The job copies Salesforce's value
 * *including null* over whatever is there, so a one-off fill would have been
 * silently undone at the next :45.
 *
 * Result: live clients with a domain went from 133 to 197 of 215.
 */
create or replace function public.refresh_client_domains()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  -- Absent between Coupler's drop and recreate, so this waits for the next run
  -- rather than failing the whole maintenance pass.
  if to_regclass('public.sf_clients_raw') is null then
    return 0;
  end if;

  with candidate as (
    select
      sf.id as sf_id,
      nullif(lower(trim(sf.email_domain__c)), '')                                  as explicit,
      nullif(lower(split_part(trim(sf.client_decision_maker_contact_email__c), '@', 2)), '') as dm,
      nullif(lower(split_part(trim(sf.client_main_contact_email__c), '@', 2)), '')          as main
    from sf_clients_raw sf
  ),
  resolved as (
    select
      sf_id,
      coalesce(
        explicit,
        case when dm   not in (select d from unnest(public.freemail_domains()) d) then dm end,
        case when main not in (select d from unnest(public.freemail_domains()) d) then main end
      ) as domain
    from candidate
  )
  update org_clients c
  set email_domain = r.domain
  from resolved r
  where r.sf_id = c.salesforce_client_id
    and c.email_domain is distinct from r.domain;

  get diagnostics touched = row_count;
  return touched;
end;
$$;

/* A named list rather than a literal in the query, so the next place that
   needs to ignore personal addresses uses the same one. */
create or replace function public.freemail_domains()
returns text[]
language sql immutable
as $$
  select array[
    'gmail.com','googlemail.com','yahoo.com','ymail.com','outlook.com','hotmail.com',
    'live.com','msn.com','aol.com','icloud.com','me.com','mac.com','protonmail.com',
    'proton.me','comcast.net','att.net','sbcglobal.net','verizon.net'
  ];
$$;

comment on function public.refresh_client_domains() is
  'Sets each client email domain from Salesforce: the explicit field, else the decision maker''s address, else the main contact''s. Free-mail domains are skipped. Runs hourly for logos.';
