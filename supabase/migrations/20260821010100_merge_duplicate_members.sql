-- Six people existed twice, from the original org seed: the Salesforce list gave
-- name@bethefactur.com while the app's own auth accounts and rep records gave
-- first.last@facturmfg.com, and the seed matched on email alone.
--
-- The @facturmfg.com row is the person as the app knows them -- it carries the
-- login, the rep link and any direct reports -- so that one survives, and the
-- Salesforce id and roles from the other are carried onto it.
--
-- Recorded for history; already applied. Re-running is harmless: the dropped
-- addresses no longer exist.

do $$
declare pair record;
begin
  for pair in
    select * from (values
      ('chad.kinner@facturmfg.com','chad@bethefactur.com'),
      ('darryl.mechell@facturmfg.com','darryl@bethefactur.com'),
      ('eli.garcia@facturmfg.com','eli@bethefactur.com'),
      ('josh.hobson@facturmfg.com','josh@bethefactur.com'),
      ('matt.beaver@facturmfg.com','matt@bethefactur.com'),
      ('srdjan.todorovic@facturmfg.com','srdjan@bethefactur.com')
    ) as p(keep_email, drop_email)
  loop
    update public.org_members k
    set salesforce_user_id = d.salesforce_user_id, needs_review = false
    from public.org_members d
    where k.email = pair.keep_email and d.email = pair.drop_email
      and k.salesforce_user_id is null;

    insert into public.org_assignments (member_id, role_id, team_id, allocation, is_primary)
    select k.id, a.role_id, a.team_id, a.allocation, a.is_primary
    from public.org_members k, public.org_members d
    join public.org_assignments a on a.member_id = d.id
    where k.email = pair.keep_email and d.email = pair.drop_email
      and not exists (select 1 from public.org_assignments x
                      where x.member_id = k.id and x.role_id = a.role_id);

    update public.org_members m
    set manager_member_id = k.id
    from public.org_members k, public.org_members d
    where k.email = pair.keep_email and d.email = pair.drop_email
      and m.manager_member_id = d.id;

    delete from public.org_members where email = pair.drop_email;
  end loop;
end $$;
