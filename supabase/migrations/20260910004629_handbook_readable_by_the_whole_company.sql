/*
 * The handbook belongs to everyone.
 *
 * Publishing decides what appears as training on somebody's learner dashboard.
 * It was also, by accident, deciding what could be read at all -- so 150 of 151
 * courses were unreadable, and a question like "what is our parental leave
 * policy" had an answer sitting in the database that nobody could reach.
 *
 * Reading is now open to anybody with a Factur account, whatever their role and
 * whether or not the course is published. It does not depend on lms.learn
 * either: five people across three roles do not hold that permission, and there
 * is no reason the Financial Manager cannot look up the offboarding checklist.
 *
 * The learner dashboard still shows published courses only -- it filters in its
 * own query rather than leaning on this policy, so drafts do not turn up as
 * assigned training.
 *
 * The four restricted courses are untouched: pay, company finances and
 * assessment material still need lms.restricted.
 */
drop policy if exists "Factur users view published courses" on public.courses;

create policy "Factur users read the handbook"
  on public.courses for select
  using (
    (select public.is_factur_user())
    and (not restricted or (select public.handbook_can_read_restricted()))
  );

/*
 * Modules sit between a course and its lessons. If they carry the old
 * published rule the chain breaks in the middle -- readable course, readable
 * lesson, invisible module -- and anything that walks the structure returns
 * nothing.
 */
drop policy if exists "Factur users can view modules" on public.modules;
drop policy if exists "Factur users view published modules" on public.modules;

create policy "Factur users read the handbook"
  on public.modules for select
  using (
    (select public.is_factur_user())
    and not public.module_is_restricted(id)
  );
