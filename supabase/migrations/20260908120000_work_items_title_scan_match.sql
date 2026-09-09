/*
 * A fourth way a task finds its client.
 *
 * The Finance list follows no single naming convention, so matching the prefix
 * before " - " found 326 of its 638 tasks. Scanning the whole title for any
 * client name finds 413. It is the loosest of the four rules and the one most
 * worth being able to audit later, so it records itself distinctly rather than
 * hiding inside 'title'.
 */
alter table public.work_items
  drop constraint if exists work_items_client_match_check;

alter table public.work_items
  add constraint work_items_client_match_check
  check (client_match in ('folder', 'alias', 'title', 'title_scan', 'space', 'manual'));
