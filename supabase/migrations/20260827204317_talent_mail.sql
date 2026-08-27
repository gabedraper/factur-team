/*
 * Email, joined up.
 *
 * The app already sends and reads Gmail as a member of staff, through the
 * service account's domain-wide delegation -- collections drafts into a
 * mailbox and the billing ingest reads out of one. Talent reuses exactly that,
 * so none of this needs a new credential.
 *
 * What it does need is somewhere to keep the identifiers that let an outgoing
 * message and the reply to it become one thread rather than two unrelated rows.
 */

/*
 * The RFC Message-ID is written by us and is identical in every copy of the
 * message; Gmail's own id is per-mailbox. Keeping both is what lets the sync
 * recognise its own sent mail coming back rather than filing it twice.
 */
alter table public.tal_activities
  add column if not exists thread_id text;
create index if not exists tal_activities_thread_idx
  on public.tal_activities (thread_id) where thread_id is not null;

alter table public.tal_campaign_sends
  add column if not exists rfc_message_id text,
  add column if not exists gmail_id text,
  add column if not exists thread_id text,
  add column if not exists activity_id uuid references public.tal_activities(id) on delete set null;

/*
 * Which mailboxes the sync reads.
 *
 * Empty means nobody, and that is the right default: reading a colleague's
 * mail is a decision somebody has to make on purpose, not something that
 * starts happening because a feature shipped. Google will hand this app a
 * token for anyone in the domain, so the restraint has to live here.
 */
alter table public.tal_settings
  add column if not exists mail_accounts text[] not null default '{}'::text[],
  add column if not exists mail_sync_days int not null default 30,
  add column if not exists mail_last_sync_at timestamptz,
  add column if not exists mail_last_sync_note text;

/*
 * A person's every email address, flattened.
 *
 * The sync matches thousands of messages against thousands of people on every
 * run, and doing that from the jsonb column means unnesting it per message.
 * This is the lookup table that turns it into one hash join.
 */
create or replace view public.tal_person_emails
with (security_invoker = true) as
select
  p.id as person_id,
  lower(btrim(e ->> 'value')) as email
from public.tal_people p
cross join lateral jsonb_array_elements(p.emails) as e
where p.merged_into_id is null
  and coalesce(btrim(e ->> 'value'), '') <> '';

/*
 * Marks everybody in a campaign who has written back.
 *
 * Run after a sync rather than per message: a reply stops a sequence, and
 * deciding that one row at a time means a candidate who replied on Friday
 * still gets Monday's follow-up because the rows were processed in the wrong
 * order.
 */
create or replace function public.tal_mark_campaign_replies()
returns int
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
declare n int;
begin
  if not public.tal_can_edit() then
    raise exception 'Forbidden: talent.recruit required';
  end if;

  with replied as (
    select distinct m.id
    from public.tal_campaign_members m
    join public.tal_campaigns c on c.id = m.campaign_id
    join public.tal_activities a on a.person_id = m.person_id
    where m.status = 'active'
      and c.stop_on_reply
      and a.direction = 'inbound'
      and a.external_source = 'gmail'
      and a.occurred_at > m.enrolled_at
  )
  update public.tal_campaign_members m
     set status = 'replied', finished_at = now(), next_due_at = null
    from replied r
   where m.id = r.id;

  get diagnostics n = row_count;
  return n;
end;
$function$;

grant execute on function public.tal_mark_campaign_replies() to authenticated;
