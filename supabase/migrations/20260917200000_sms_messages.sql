/*
 * Every text Dialpad tells us about, whichever surface sent it.
 *
 * The Mini Dialer embed has its own compose box, and so does the standalone
 * Dialpad app, and neither passes through anything of ours -- both send
 * straight to Dialpad's servers. A text sent that way used to be invisible
 * to this app entirely: not on the client, not on the Opportunity, nowhere.
 * Subscribing to Dialpad's SMS event webhook (app/api/dialpad/sms) fixes
 * that the same way missed calls got fixed for voice: one row per message
 * Dialpad reports, keyed on its own message id so a repeat delivery updates
 * rather than duplicates.
 *
 * Written only by that route, on the service key; people read their own.
 * Deliberately has no client_id/contact resolution -- see lib/dialpad/match.ts
 * -- so this can land without stepping on the unified activity ingest that
 * owns that join elsewhere.
 */
create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('dialpad')),
  provider_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  mms boolean not null default false,
  from_number text,
  to_number text,
  /*
   * Null unless the Dialpad API key used to create the subscription carries
   * the message_content_export (or :all) scope -- Dialpad omits message
   * text by default. A row with no body still proves a text happened.
   */
  body text,
  /* Whose Dialpad line this was, from the rotation pool. */
  member_id uuid references public.org_members(id) on delete set null,
  /* Dialpad's own name for the external party -- not CRM-resolved. */
  contact_name text,
  message_status text
    check (message_status is null or message_status in ('sent', 'failed', 'pending', 'delivered', 'undelivered')),
  message_delivery_result text,
  sent_at timestamptz not null default now(),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_message_id)
);

comment on table public.sms_messages is
  'Every SMS/MMS a provider reported, sent from any of that provider''s own surfaces.';

create index if not exists sms_messages_member_idx
  on public.sms_messages (member_id, sent_at desc);

alter table public.sms_messages enable row level security;

drop policy if exists sms_messages_read on public.sms_messages;
create policy sms_messages_read on public.sms_messages
  for select to authenticated
  using (
    public.is_factur_user()
    and (
      public.has_permission('org.manage')
      or member_id in (select id from public.org_members where auth_user_id = auth.uid())
    )
  );

/* No insert/update policy on purpose: the event route writes on the service key. */
