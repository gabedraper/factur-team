/*
 * Indexes behind the header search.
 *
 * Every list searched inside its own view, so a record the view did not
 * contain could not be found at all. The header search looks across every
 * record a person can see, and that is only affordable with an index that can
 * answer "contains" -- a btree cannot, which is why picklist filters had to
 * move to equals. Trigram GIN can: it answers ilike '%smith%' from the index.
 *
 * Each is on one lowercased expression per table rather than a column each,
 * so a single ilike covers first name, last name and email together -- and so
 * "john smith" matches a contact whose first and last names are in separate
 * columns. The search function has to use exactly these expressions or the
 * planner will not recognise them.
 *
 * Phone gets its own digits-only expression: numbers are stored in every shape
 * Salesforce ever accepted, and "(317) 437" should find +13174373411.
 *
 * CONCURRENTLY, because the Salesforce sync writes to these tables every few
 * minutes and a plain CREATE INDEX would stall it. Applied with autocommit.
 */

create index concurrently if not exists crm_contacts_search_trgm
  on public.crm_contacts using gin (
    lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, ''))
    gin_trgm_ops
  );

create index concurrently if not exists crm_contacts_phone_digits_trgm
  on public.crm_contacts using gin (
    regexp_replace(coalesce(phone, ''), '\D', '', 'g') gin_trgm_ops
  );

create index concurrently if not exists crm_accounts_search_trgm
  on public.crm_accounts using gin (
    lower(coalesce(name, '') || ' ' || coalesce(domain, '')) gin_trgm_ops
  );

create index concurrently if not exists opportunities_name_trgm
  on public.opportunities using gin (lower(coalesce(name, '')) gin_trgm_ops);
