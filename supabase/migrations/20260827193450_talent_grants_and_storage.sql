/*
 * Who starts with the talent permissions, and where resumes live.
 *
 * The role list already had "Recruiter & People Operations" in it, which is the
 * obvious home for the working right. Everyone else is deliberately left off --
 * Settings -> Roles is where this gets widened, and guessing wrong here would
 * put a candidate database in front of the whole company on day one.
 */

insert into public.org_role_permissions (role_id, permission_key)
select r.id, p.key
from public.org_roles r
cross join (values ('talent.view'), ('talent.recruit'), ('talent.admin')) as p(key)
where r.slug = 'app-admin'
on conflict do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select r.id, p.key
from public.org_roles r
cross join (values ('talent.view'), ('talent.recruit')) as p(key)
where r.slug = 'recruiter-people-operations'
on conflict do nothing;

insert into public.org_role_permissions (role_id, permission_key)
select r.id, 'talent.view'
from public.org_roles r
where r.slug in ('ceo', 'financial-manager')
on conflict do nothing;

/*
 * Resumes are private -- the bucket is not public and every read goes through a
 * signed URL, because a public bucket means a candidate's CV is one guessed
 * path away from being on the open web.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'talent-documents', 'talent-documents', false, 26214400,
  array['application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain','image/png','image/jpeg']
)
on conflict (id) do nothing;

drop policy if exists tal_docs_read on storage.objects;
create policy tal_docs_read on storage.objects for select
  using (bucket_id = 'talent-documents' and public.tal_can_view());

drop policy if exists tal_docs_write on storage.objects;
create policy tal_docs_write on storage.objects for insert
  with check (bucket_id = 'talent-documents' and public.tal_can_edit());

drop policy if exists tal_docs_update on storage.objects;
create policy tal_docs_update on storage.objects for update
  using (bucket_id = 'talent-documents' and public.tal_can_edit());

drop policy if exists tal_docs_delete on storage.objects;
create policy tal_docs_delete on storage.objects for delete
  using (bucket_id = 'talent-documents' and public.tal_can_edit());

update public.tal_integrations
   set status = 'connected', connected_at = now()
 where slug = 'storage';

update public.tal_integrations
   set status = 'connected', connected_at = now(),
       config = jsonb_build_object('note', 'Shared with the rest of the app. A verified sending domain is still needed before talent mail goes out at volume.')
 where slug = 'resend';
