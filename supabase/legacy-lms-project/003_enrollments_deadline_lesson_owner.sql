-- Add deadline to enrollments
alter table enrollments add column if not exists deadline timestamptz;

-- Add content owner to lessons
alter table lessons add column if not exists owner_id uuid references profiles(id);

-- Add RLS policy for admins to manage enrollments
create policy "Admins can manage all enrollments" on enrollments for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
