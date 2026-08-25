# NPS — send, receive, track — handoff

Half of this is already built. `client_nps` logs scores and feeds the client
health score; a panel on the client page lets an org manager type in a score
collected somewhere else. What is missing is the *asking*: emailing clients a
survey and capturing what comes back without anyone retyping it.

Scoped 2026-08-25. Decisions below were made by Gabe, not guessed.

## Decisions already made

- **Recipients come from Salesforce**, not a hand-kept list in the app.
- **Sending is a campaign you launch** — pick clients, review the list, one
  click sends the batch. No cron fires email at clients unattended.
- **Each survey is sent as the client's own account owner**, through the Gmail
  API, not from a system address. This is the decision the rest of the design
  bends around; see "Sending as the owner" below.
- **Responses are visible to everyone at Factur**, name and comment included,
  matching how the rest of the client record already reads.

## What already exists (don't rebuild)

| Piece | Where |
|---|---|
| Score log, one row per response | `public.client_nps` (`supabase/migrations/20260824161623_client_nps_history.sql`) |
| Latest score + movement per client | view `public.client_nps_latest` |
| Manual entry / delete | `actions/nps.ts`, `components/clients/NpsPanel.tsx` |
| Health score consuming NPS | `lib/clients/health.ts`, `components/clients/HealthTable.tsx` |
| Acting as a member of staff in Google | `lib/google/auth.ts` (`tokenFor`) |
| Checking delegation works | `actions/google-check.ts` |
| Email as a fallback path | `resend` v6, used in `actions/bug-report.ts` |

`client_nps.recorded_by` is nullable, which is what lets a self-service response
land with no Factur user attached. No change needed there.

## Recipients: already synced, no new pipeline

`public.sf_clients_raw` — the Coupler feed of the Salesforce Client object —
already carries two email fields:

- `client_main_contact_email__c`
- `client_decision_maker_contact_email__c`

Live counts as of 2026-08-25:

| Client status | Clients | Have at least one email |
|---|---|---|
| Active | 158 | 152 |
| Onboarding | 44 | 23 |
| Hold | 4 | 3 |
| Financial Pause | 1 | 1 |
| Inactive | 774 | 663 |

So a v1 quarterly campaign to Active clients is ~150 emails. **No new Coupler
dataflow and no Salesforce Contact sync is needed.** (The `Contact` object holds
4 million prospecting records and is the wrong source anyway.)

Join path: `org_clients.salesforce_client_id` = `sf_clients_raw.id`.

**Critical constraint:** Coupler drops and recreates `sf_clients_raw` on every
sync, taking RLS policies, indexes, and any dependent view with it. Do not build
a view on it. Read it inside a `SECURITY DEFINER` function, or snapshot the two
email columns into an app-owned table at send time — the second is better here,
because a campaign needs to record who it *actually* mailed, not who the raw
table happens to list a month later.

## Sending as the owner

A survey from the person a client actually talks to gets answered. One from a
system address gets deleted. So each email goes out through the **Gmail API,
sent as the client's owner** — it lands in that person's Sent folder, threads
normally, and replies reach them with nothing to configure.

**Who sends to whom:** `org_clients.member_id` -> `org_members.email`. Of the 158
Active clients, 145 resolve to a named owner across ~20 people. All are
`@facturmfg.com` Google Workspace accounts.

**What has to change in `lib/google/auth.ts`:** add a fourth entry to `SCOPES`
for `https://www.googleapis.com/auth/gmail.send`. Keep it a *separate* key from
the existing `gmail` (readonly) entry rather than widening that one — the ingest
has no business holding a send permission.

That file's own comment is the thing to take most seriously here:

> Google will hand over a token for anyone in the domain, so the restraint has
> to live in the code that decides whose name to put in this field.

That was written when every scope was read-only. With a send scope it means a
bug in sender resolution doesn't leak data, it sends mail under a colleague's
name. So: resolve the sender from `org_members` only, never from user input,
and refuse to send rather than falling back to a default sender when resolution
fails.

**What this costs you:** no bounce webhooks and no open tracking. Bounces arrive
as messages in the owner's inbox instead of as data. Track *sent* and
*responded*; don't build a delivered/opened column that can't be filled.

**Quota:** Workspace allows 2,000 recipients per user per day. A ~150-email
campaign split across 20 people is nowhere near it.

**Fallback:** if Workspace admin approval doesn't come through, the same
campaign can send through Resend with the owner's address in the From line —
worse (not in their Sent folder, replies not threaded on their side) but
workable. Build the send step behind one interface so the swap is one file.
Note that this fallback needs the **root** `facturmfg.com` domain verified in
Resend, not a subdomain, because the From must be a real person's address.

## Two blockers, both human

1. **Workspace admin has to approve the send scope** on the existing service
   account's domain-wide delegation. `docs/google-workspace-ingest.md` step 6
   is the same procedure; it deliberately says "There is no scope here that can
   send, delete or change anything", so that line needs updating along with the
   scope list. Extend `actions/google-check.ts` to verify the send scope too, so
   a refused delegation shows up as a clear message rather than a failed campaign.
2. **The 37 clients owned by `facturcustomersuccess@facturmfg.com` need real
   owners assigned** before the first campaign. That's a shared mailbox, not a
   person, and it covers more Active clients than anyone else — sending from it
   throws away the entire reason for sending as the owner. This is a data fix in
   the client settings page, done by hand, and it is a prerequisite rather than
   something the build session can solve. The remaining 13 unassigned Active
   clients need owners too.

Everything else below is buildable today.

## What to build

### 1. Migration — campaigns, sends, and a token per recipient

```
nps_campaigns    id, name, period (date), status (draft|sending|sent),
                 created_by, created_at, sent_at
nps_sends        id, campaign_id, client_id,
                 recipient_email, recipient_name,
                 sender_email, sender_member_id,
                 token (unique, random),
                 sent_at, responded_at, error
```

`sender_email` is snapshotted at send time, not joined at read time — who owned
a client last quarter is part of the record, and ownership changes.

`token` is the whole security model for the public page: long, random, single
client, unguessable. Generate with `gen_random_bytes`, not anything sequential.

Then add `nps_send_id` (nullable, unique) to `client_nps` so a self-service
response points back at the invitation that produced it, and a second response
on the same token cannot create a duplicate row. Keep it nullable — manually
recorded scores have no send.

RLS: reads open to `is_factur_user()`, writes to `org.manage`, same shape as
`client_nps`. The public response path must go through a `SECURITY DEFINER`
function keyed on the token, never through anon read access to these tables.

### 2. Public response page — `app/nps/[token]/page.tsx`

Unauthenticated. `middleware.ts` gates only the prefixes listed in
`protectedPrefixes`, so a new `/nps` route is public with no middleware change —
verify that rather than assuming it.

Eleven buttons, 0 to 10. Clicking one records the score immediately (a client who
closes the tab after clicking still counts), then reveals an optional comment
box. Re-opening a used token shows what they answered and lets them change it —
do not show an error.

Per the no-explanatory-UI-text rule: the NPS question itself, the scale, the
buttons, a comment box. Nothing else.

### 3. Campaign builder — `app/(dashboard)/clients/nps/`

Gated on `org.manage`. Pick a status filter (default Active), then show the
resolved list with **both** ends visible: recipient address and the owner it
will be sent as. Two exclusion lists, shown not hidden — clients with no
recipient email, and clients with no resolvable owner. A silent drop reads as
"everyone was contacted" when 13 were not.

Because it sends as ~20 different people, the email body should read as though
that person wrote it: plain text, first person, signed with their name. No
letterhead, no logo, no marketing chrome — that is what makes it look like a
personal note rather than a survey blast, and it is most of the response rate.

Write one `nps_sends` row per recipient before dispatch, then stamp `sent_at` or
`error` per result. If the run dies halfway, the rows already written are the
record of what went out. Group by sender and send each person's batch with a
concurrency cap.

### 4. Tracking

Extend the existing client health view rather than adding a parallel one.
Per campaign: sent, responded, response rate, NPS (promoters 9-10 minus
detractors 0-6, as a percentage), and the comments. Per client, the existing
`client_nps_latest` already gives level and movement.

Response rate by sender is worth having — it is the only way to find out whether
sending as the owner actually did what it was chosen to do.

## Order to build it in

1. Migration + `SECURITY DEFINER` response function.
2. Public `/nps/[token]` page — testable end to end by inserting one send row by hand.
3. `gmail.send` scope + `actions/google-check.ts` extension, verified against
   Gabe's own address before any client is involved.
4. Campaign builder, capped to internal recipients until a real campaign is approved.
5. Campaign tracking view.

Steps 1, 2 and 5 need nothing from anyone. Step 3 needs the Workspace admin.
Step 4 shouldn't run for real until the 50 Active clients without a proper owner
have one.
