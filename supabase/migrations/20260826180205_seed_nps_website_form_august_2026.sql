/*
 * The fifteen responses the WordPress form collected, 18-24 August 2026.
 *
 * Imported as a real campaign rather than as loose scores. Each of these had a
 * recipient, a sender and a reply, which is exactly what an nps_send is -- the
 * only thing it lacked was a token this app issued. Loading it any other way
 * would leave the tracking view unable to show a response rate for the period
 * the company actually has data for.
 *
 * Every row is matched to a client through the contact addresses already synced
 * on sf_clients_raw. All fifteen matched; the join is written to fail loudly
 * (fewer rows inserted than expected) rather than silently drop an unmatched
 * one -- see the count check at the end.
 *
 * Idempotent: nps_sends.external_id holds the form's submission id, so
 * re-running this, or importing a later export that overlaps it, inserts
 * nothing twice. That is what makes it safe to run on a schedule.
 *
 * Timestamps are stored as given. The export carries no timezone; only the date
 * is used for reporting, and none of these sit close enough to midnight for the
 * interpretation to move one.
 */

insert into public.nps_campaigns (name, period, status, source, sent_at)
select 'Website form — August 2026', date '2026-08-01', 'sent', 'website-form',
       timestamptz '2026-08-18 14:54:53+00'
where not exists (
  select 1 from public.nps_campaigns where name = 'Website form — August 2026'
);

with responses (external_id, email, first_name, score, comment, follow_up, at) as (
  values
  ('4092', 'aholmes@onramp-solutions.com', 'Andrew', 6,
   $c$Still very early, looking forward to having leads start to come in. Tanaka has been great.$c$,
   false, timestamptz '2026-08-19 09:10:42+00'),

  ('4081', 'bill@gagneinc.com', 'Bill', 0,
   $c$Darryl, I appreciate asking for feedback. Honest feedback is there has been no value added to Gagne to date since we started around the first week of July. I would like the process to improve and results to come in. That is obviously the goal for you and Gagne. Internally, we're not optimistic. No sense giving you a fluff answer. When we interviewed Nash we expected a up close and personal sales-person and we seem to be getting outsourced South African options for reps. I understand Tanaka we said to keep going. I haven't heard a blip since and don't honestly think that's working. We would recommend a proven Texan (lol) or American that can generate leads. That would be my real honest recommendation. I am happy to personally talk to the person real time to continuously train and craft the message on our product offerings. I've offered that to Tanaka but it hasn't gone anywhere. If Factur just doesn't think they can sell Gagne and find leads I understand and we can part ways early. Long winded but that's my feedback. Just lmk what direction we can take it.$c$,
   true, timestamptz '2026-08-18 15:03:45+00'),

  ('4080', 'davids@rogancorp.com', 'David', 5,
   $c$Good work has been done, but we are still waiting for our first PO.$c$,
   false, timestamptz '2026-08-18 14:54:53+00'),

  ('4121', 'jhall@geospace.com', 'Jason', 8,
   null, false, timestamptz '2026-08-24 15:09:31+00'),

  ('4106', 'jennifer@trtooling.com', 'Jennifer', 8,
   $c$I don't have specific area for improvement. I would just say to anyone coming in to FACTUR to really consider long term goals so that you can work with your FACTUR team to create the best sales campaigns. Once we were able to get on track with that, Eli was a big help, we are seeing much more success.$c$,
   false, timestamptz '2026-08-21 08:47:31+00'),

  ('4102', 'kurts@metal-services.com', 'Kurt', 7,
   null, false, timestamptz '2026-08-20 16:18:35+00'),

  ('4091', 'justin@diecraftmachine.com', 'Justin', 8,
   $c$So far so good. We realize that the process takes time. It appears we are on track and I like the opportunities we are seeing$c$,
   false, timestamptz '2026-08-19 07:36:47+00'),

  ('4086', 'gm@apcmfg.net', 'Andres', 8,
   $c$We got some good leads from the initial email campaign which we are working on but need to get more on the pipeline.
Tanaka is doing a good job following up.$c$,
   false, timestamptz '2026-08-18 18:21:53+00'),

  -- The four highest scorers were never asked the follow-up question: the
  -- "great" landing page does not carry it. Null, not false -- not asked is not
  -- the same as declined.
  ('4119', 'adam@vgdynamic.com', 'Adam', 9,
   $c$Gaining new sales opportunities$c$,
   null, timestamptz '2026-08-24 15:00:14+00'),

  ('4118', 'alex@jcmoag.com', 'Alex', 9,
   $c$Great communication, qualified leads.$c$,
   null, timestamptz '2026-08-24 14:59:28+00'),

  ('4101', 'curren.sigur@lindemann-metalrecycling.com', 'Curren', 10,
   $c$I appreciate your professionalism, commitment to the plan, and dedication to understanding our company and products; and I absolutely love Phil's energy and enthusiasm.$c$,
   null, timestamptz '2026-08-20 15:59:31+00'),

  ('4100', 'jcerdas@acpmfg.com', 'Jose', 9,
   $c$Good responsiveness - highly professional.$c$,
   null, timestamptz '2026-08-20 14:56:47+00'),

  ('4084', 'alan@hartmannsinc.com', 'Alan', 10,
   $c$The personal touch and how they totally understand who we are as a company and fit in like one of us.$c$,
   null, timestamptz '2026-08-18 16:16:43+00'),

  ('4083', 'scott.stenka@duncanaviation.com', 'Scott', 10,
   $c$I feel like Factur is our inner marketing department and we are in it together.$c$,
   null, timestamptz '2026-08-18 15:21:55+00'),

  ('4082', 'timo@tlspecialty.com', 'Timothy', 10,
   $c$I can tell your organization has an understanding of the buying/selling process and focused on what is required for growth. Your entire team is professional and easy to work with. We are very early in the process, but the fact that I can see you work a process is encouraging that we will see success together.$c$,
   null, timestamptz '2026-08-18 15:18:26+00')
),

-- One client per response. A contact can sit in either Salesforce field, and in
-- principle in two client records; take one deterministically rather than
-- letting a duplicate fan the row out into two scores.
matched as (
  select r.*, m.client_id
  from responses r
  cross join lateral (
    select oc.id as client_id
    from public.org_clients oc
    join public.sf_clients_raw c on c.id = oc.salesforce_client_id
    where lower(c.client_main_contact_email__c) = r.email
       or lower(c.client_decision_maker_contact_email__c) = r.email
    order by oc.active desc, oc.name
    limit 1
  ) m
),

sent as (
  insert into public.nps_sends (
    campaign_id, client_id, recipient_email, recipient_name,
    sender_email, external_id, sent_at, responded_at
  )
  select c.id, m.client_id, m.email, m.first_name,
         'darryl.mechell@facturmfg.com', m.external_id, m.at, m.at
  from matched m
  cross join (select id from public.nps_campaigns
               where name = 'Website form — August 2026') c
  on conflict (external_id) where external_id is not null do nothing
  returning id, client_id, external_id, recipient_name
)

insert into public.client_nps (
  client_id, score, collected_on, respondent, comment, follow_up_requested, nps_send_id
)
select s.client_id, r.score::smallint, r.at::date, s.recipient_name,
       r.comment, r.follow_up, s.id
from sent s
join responses r on r.external_id = s.external_id
on conflict (nps_send_id) where nps_send_id is not null do nothing;

-- Loud rather than silent: if a contact address stopped matching, this stops
-- the migration instead of quietly importing fourteen of fifteen.
do $$
declare n int;
begin
  select count(*) into n
  from public.nps_sends s
  join public.nps_campaigns c on c.id = s.campaign_id
  where c.name = 'Website form — August 2026';

  if n <> 15 then
    raise exception 'Expected 15 imported responses, found %', n;
  end if;
end $$;
