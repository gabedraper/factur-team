/*
 * How much each input counts toward a client's overall health.
 *
 * A table rather than numbers buried in a query, so the balance can be tuned
 * without a deploy -- the same arrangement as the scoreboard's effort weights.
 * Sentiment is listed but disabled: there is no text to read yet, and a row
 * sitting at zero weight is a clearer statement of that than silence.
 */
create table if not exists public.client_health_weights (
  input text primary key,
  label text not null,
  weight numeric not null check (weight >= 0),
  enabled boolean not null default true,
  position int not null default 0
);

insert into public.client_health_weights (input, label, weight, enabled, position) values
  ('lead_flow',  'Lead flow',           25, true,  1),
  ('activity',   'Account manager activity', 20, true,  2),
  ('nps',        'NPS',                 20, true,  3),
  ('engagement', 'Client engagement',   20, true,  4),
  ('receivables','Accounts receivable', 15, true,  5),
  ('sentiment',  'Client sentiment',     0, false, 6)
on conflict (input) do nothing;

alter table public.client_health_weights enable row level security;

create policy "Factur users read health weights" on public.client_health_weights
  for select to authenticated using (public.is_factur_user());

create policy "Org managers set health weights" on public.client_health_weights
  for all to authenticated
  using (public.has_permission('org.manage'))
  with check (public.has_permission('org.manage'));
