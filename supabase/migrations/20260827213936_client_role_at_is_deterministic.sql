/*
 * Order before limiting.
 *
 * The unique index guarantees one *open* row per client and field, but says
 * nothing about closed ones, so a bare `limit 1` on a point-in-time lookup
 * would pick an arbitrary row if two ranges ever overlapped. Newest wins.
 */
create or replace function public.client_role_at(
  p_client_id uuid, p_field text, p_at timestamptz
)
returns uuid
language sql stable
security definer
set search_path to 'public'
as $$
  select h.member_id
  from public.client_history h
  where h.client_id = p_client_id
    and h.field = p_field
    and h.valid_from <= p_at
    and (h.valid_to is null or h.valid_to > p_at)
  order by h.valid_from desc
  limit 1;
$$;

revoke all on function public.client_role_at(uuid, text, timestamptz) from public, anon;
grant execute on function public.client_role_at(uuid, text, timestamptz) to authenticated, service_role;
