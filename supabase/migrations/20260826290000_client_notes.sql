/*
 * Notes on a client's money: ours, and QuickBooks'.
 *
 * QuickBooks holds one free-text box per customer -- 869 of them have something
 * in it, and it is where concessions and payment arrangements get written down.
 * It has no date and no author and gets overwritten in place, so it is not an
 * event and cannot sit in a timeline honestly. It comes back as a note that is
 * always pinned and never editable here: whoever wrote it wrote it in
 * QuickBooks, and that is where it has to be changed.
 *
 * Ours are dated, attributed, and can be pinned. An unpinned note is an event
 * and takes its place in the trail by date; a pinned one is standing context --
 * "they pay on the 5th, do not chase before then" -- and belongs at the top
 * where somebody about to send a chase will actually see it.
 */
create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.org_clients(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  pinned boolean not null default false,
  author_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_notes_client_idx
  on public.client_notes (client_id, pinned desc, created_at desc);

alter table public.client_notes enable row level security;

drop policy if exists client_notes_read on public.client_notes;
create policy client_notes_read on public.client_notes
  for select to authenticated
  using (public.is_factur_user()
         and (public.has_permission('clients.health')
              or public.has_permission('finance.collections')
              or public.has_permission('org.manage')));

/*
 * Both kinds in one list, QuickBooks first.
 *
 * The QuickBooks note carries a null id, which is what tells the screen it
 * cannot be edited or deleted -- rather than a flag somebody could forget to
 * check.
 */
create or replace function public.get_client_notes(p_client_id uuid)
returns table (
  id uuid,
  source text,
  body text,
  pinned boolean,
  author_email text,
  created_at timestamptz
)
language sql stable security definer set search_path to 'public'
as $function$
  with allowed as (
    select 1 where public.is_factur_user()
      and (public.has_permission('clients.health')
           or public.has_permission('finance.collections')
           or public.has_permission('org.manage'))
  ),
  qb as (
    select nullif(trim(c.notes), '') as notes
    from public.get_client_quickbooks(true) l
    join public.qb_customers_raw c on c.id::text = l.qb_customer_id
    where l.client_id = p_client_id
    limit 1
  )
  select null::uuid, 'quickbooks'::text, qb.notes, true, null::text, null::timestamptz
  from qb
  where qb.notes is not null and exists (select 1 from allowed)

  union all

  select n.id, 'app', n.body, n.pinned, n.author_email, n.created_at
  from public.client_notes n
  where n.client_id = p_client_id and exists (select 1 from allowed)

  order by 4 desc, 6 desc nulls first;
$function$;

revoke all on function public.get_client_notes(uuid) from public, anon;
grant execute on function public.get_client_notes(uuid) to authenticated, service_role;
