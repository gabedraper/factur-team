/*
 * The asking half of NPS.
 *
 * `client_nps` already records what a client said. These two tables record that
 * we asked -- which client, which contact, which owner it went out as, and the
 * token that lets that one person answer without an account. Keeping the
 * invitation separate from the response is what makes a response *rate*
 * computable: silence is only measurable against a known ask.
 */

create table if not exists public.nps_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,

  -- The quarter (or month) being measured, stored as its first day. The cadence
  -- is not pinned into the data -- same reasoning as client_nps.collected_on.
  period date not null,

  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent')),

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.nps_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.nps_campaigns(id) on delete cascade,
  client_id uuid not null references public.org_clients(id) on delete cascade,

  /*
   * Both ends of the email are copied in rather than joined at read time.
   *
   * The contact address lives in sf_clients_raw, which Coupler drops and
   * recreates on every sync -- a join to it is a join to whatever Salesforce
   * says today, not to the address we actually mailed. Ownership moves too, and
   * "who asked" is part of the record once it is sent.
   */
  recipient_email text not null,
  recipient_name text,
  sender_email text,
  sender_member_id uuid references public.org_members(id) on delete set null,

  /*
   * The whole security model of the public response page.
   *
   * 24 random bytes, hex encoded: 192 bits, unguessable, and scoped to one
   * contact at one client for one campaign. pgcrypto lives in the extensions
   * schema, so it is qualified -- the functions below set search_path to public
   * and would not find it otherwise.
   */
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),

  sent_at timestamptz,
  responded_at timestamptz,
  error text,
  created_at timestamptz not null default now(),

  -- One invitation per contact per campaign. A rerun of a half-finished send
  -- should not mail the same person twice.
  unique (campaign_id, client_id, recipient_email)
);

create index if not exists nps_sends_campaign_idx on public.nps_sends (campaign_id);
create index if not exists nps_sends_client_idx on public.nps_sends (client_id);

/*
 * Which invitation produced a response.
 *
 * Nullable because a score typed in by hand has no invitation behind it, and
 * those are the only kind that exist today. Unique so that a client clicking
 * twice corrects their answer instead of stacking a second one -- Postgres
 * allows many nulls in a unique column, so hand-entered rows are unaffected.
 */
alter table public.client_nps
  add column if not exists nps_send_id uuid references public.nps_sends(id) on delete set null;

create unique index if not exists client_nps_send_idx
  on public.client_nps (nps_send_id) where nps_send_id is not null;

alter table public.nps_campaigns enable row level security;
alter table public.nps_sends enable row level security;

-- Reads open to the company, writes to whoever manages the org: the same shape
-- as client_nps, so a campaign is as visible as the scores it produced.
drop policy if exists "Factur users read NPS campaigns" on public.nps_campaigns;
create policy "Factur users read NPS campaigns" on public.nps_campaigns
  for select to authenticated using (public.is_factur_user());

drop policy if exists "Org managers run NPS campaigns" on public.nps_campaigns;
create policy "Org managers run NPS campaigns" on public.nps_campaigns
  for all to authenticated
  using (public.has_permission('org.manage'))
  with check (public.has_permission('org.manage'));

drop policy if exists "Factur users read NPS sends" on public.nps_sends;
create policy "Factur users read NPS sends" on public.nps_sends
  for select to authenticated using (public.is_factur_user());

drop policy if exists "Org managers write NPS sends" on public.nps_sends;
create policy "Org managers write NPS sends" on public.nps_sends
  for all to authenticated
  using (public.has_permission('org.manage'))
  with check (public.has_permission('org.manage'));

/*
 * The public response path.
 *
 * A client answering has no account, so this runs as the definer. Note what is
 * deliberately *not* returned: no client name, no email, no sender. A token
 * that somehow leaked should reveal nothing about who it was for. One row means
 * the token is good; no rows means it is not, and the page shows a 404 either
 * way rather than telling a guesser which it was.
 */
create or replace function public.nps_invitation(p_token text)
returns table (score smallint, comment text)
language sql
security definer
set search_path to 'public'
as $$
  select n.score, n.comment
  from public.nps_sends s
  left join public.client_nps n on n.nps_send_id = s.id
  where s.token = p_token;
$$;

create or replace function public.record_nps_response(
  p_token text,
  p_score int,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.nps_sends;
begin
  select * into s from public.nps_sends where token = p_token;
  if not found then
    raise exception 'This survey link is not valid.' using errcode = 'no_data_found';
  end if;

  -- 0-10 is the question's own scale; the page only offers those eleven, so
  -- anything else arrived from somewhere other than the page.
  if p_score is null or p_score < 0 or p_score > 10 then
    raise exception 'Score must be a whole number from 0 to 10.' using errcode = 'check_violation';
  end if;

  insert into public.client_nps (
    client_id, score, collected_on, respondent, comment, nps_send_id
  )
  values (
    s.client_id, p_score::smallint, current_date,
    nullif(btrim(s.recipient_name), ''), nullif(btrim(p_comment), ''), s.id
  )
  on conflict (nps_send_id) where nps_send_id is not null do update
    set score = excluded.score,
        collected_on = excluded.collected_on,
        -- A null comment means "the caller did not touch it", an empty one
        -- means the client cleared the box. Only the second should erase.
        comment = case
                    when p_comment is null then client_nps.comment
                    else nullif(btrim(p_comment), '')
                  end;

  -- First answer is the one that timed the response. Changing a score later
  -- does not make the reply later.
  update public.nps_sends
     set responded_at = coalesce(responded_at, now())
   where id = s.id;
end;
$$;

/*
 * Anonymous visitors need exactly these two, and nothing else. `public` here is
 * the SQL role that every other role inherits from -- revoking first means the
 * grants below are the complete list of who may call these.
 */
revoke all on function public.nps_invitation(text) from public;
revoke all on function public.record_nps_response(text, int, text) from public;

grant execute on function public.nps_invitation(text) to anon, authenticated;
grant execute on function public.record_nps_response(text, int, text) to anon, authenticated;
