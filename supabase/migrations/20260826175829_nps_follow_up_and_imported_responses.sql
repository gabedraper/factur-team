/*
 * Two things the live survey does that the app's version did not.
 *
 * The existing process runs on a WordPress form at facturmfg.com/client-feedback,
 * and reading a real export of it showed two gaps:
 *
 * 1. It asks a second question -- "Would you like a member of your Factur team
 *    to follow up with you?" -- and that answer is the most actionable thing on
 *    the whole form. A 0 from a client asking to be contacted is a different
 *    object from a 0 from a client who does not want to talk.
 *
 * 2. Responses arrive from outside a campaign, and will keep doing so while the
 *    old form is still up. Those need somewhere to live that does not pretend
 *    an app-sent invitation existed.
 */

alter table public.client_nps
  add column if not exists follow_up_requested boolean;

comment on column public.client_nps.follow_up_requested is
  'Did the client ask to be contacted about this score? Null means they were not asked, which is not the same as no.';

/*
 * The identifier the response had wherever it came from -- a form submission
 * id, today. Unique, so importing the same export twice is a no-op rather than
 * a duplicated score, which is what makes an import safe to re-run on a
 * schedule.
 */
alter table public.nps_sends
  add column if not exists external_id text;

create unique index if not exists nps_sends_external_id_idx
  on public.nps_sends (external_id) where external_id is not null;

/*
 * Where the invitation came from. An imported row is still a real ask -- it had
 * a recipient, a sender and a reply -- so it belongs in nps_sends rather than
 * in a parallel table. It just never had a token this app issued.
 */
alter table public.nps_campaigns
  add column if not exists source text not null default 'app'
  check (source in ('app', 'website-form'));

/*
 * Rebuilt to carry the follow-up answer.
 *
 * Dropped rather than replaced: adding a parameter makes a new signature, and
 * leaving the three-argument version in place would give PostgREST two
 * candidates for /rpc/record_nps_response and an ambiguous call.
 */
drop function if exists public.record_nps_response(text, int, text);

create or replace function public.record_nps_response(
  p_token text,
  p_score int,
  p_comment text default null,
  p_follow_up boolean default null
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

  if p_score is null or p_score < 0 or p_score > 10 then
    raise exception 'Score must be a whole number from 0 to 10.' using errcode = 'check_violation';
  end if;

  insert into public.client_nps (
    client_id, score, collected_on, respondent, comment, follow_up_requested, nps_send_id
  )
  values (
    s.client_id, p_score::smallint, current_date,
    nullif(btrim(s.recipient_name), ''), nullif(btrim(p_comment), ''),
    p_follow_up, s.id
  )
  on conflict (nps_send_id) where nps_send_id is not null do update
    set score = excluded.score,
        collected_on = excluded.collected_on,
        -- Null means the caller did not touch the field; only an explicit value
        -- overwrites. Applies to both answers, for the same reason: the score
        -- is saved on click, long before either of these is filled in.
        comment = case
                    when p_comment is null then client_nps.comment
                    else nullif(btrim(p_comment), '')
                  end,
        follow_up_requested = coalesce(p_follow_up, client_nps.follow_up_requested);

  update public.nps_sends
     set responded_at = coalesce(responded_at, now())
   where id = s.id;
end;
$$;

revoke all on function public.record_nps_response(text, int, text, boolean) from public;
grant execute on function public.record_nps_response(text, int, text, boolean) to anon, authenticated;

/*
 * Also return the follow-up answer, so a client returning to the link sees what
 * they already said rather than an empty form.
 *
 * Dropped first: adding an output column changes the return type, which
 * `create or replace` refuses to do.
 */
drop function if exists public.nps_invitation(text);

create or replace function public.nps_invitation(p_token text)
returns table (score smallint, comment text, follow_up_requested boolean)
language sql
security definer
set search_path to 'public'
as $$
  select n.score, n.comment, n.follow_up_requested
  from public.nps_sends s
  left join public.client_nps n on n.nps_send_id = s.id
  where s.token = p_token;
$$;

revoke all on function public.nps_invitation(text) from public;
grant execute on function public.nps_invitation(text) to anon, authenticated;
