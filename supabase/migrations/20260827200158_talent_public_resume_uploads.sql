/*
 * An applicant has to be able to attach a CV without an account, and the
 * careers form is the only place that happens. The permission is therefore as
 * narrow as it can be: insert only, into one folder, in a bucket that already
 * caps size at 25MB and refuses anything that is not a document or an image.
 * Nobody anonymous can read this folder back, so it is a drop box rather than
 * a share -- and it closes entirely when the careers page is switched off.
 */
drop policy if exists tal_docs_public_apply on storage.objects;
create policy tal_docs_public_apply on storage.objects for insert
  to anon
  with check (
    bucket_id = 'talent-documents'
    and (storage.foldername(name))[1] = 'applications'
    and (select careers_page_enabled from public.tal_settings where id)
  );
