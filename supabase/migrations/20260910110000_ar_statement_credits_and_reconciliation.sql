/*
 * Credits on statements, and a check that the statement is true.
 *
 * Credits reach us from one place only: a payment QuickBooks has taken but not
 * yet applied, sitting on qb_payments_raw as unappliedamt. Credit memos are a
 * separate QuickBooks entity and Coupler is not pulling them, so a client whose
 * credit came from a memo will not balance. Five do not, out of seventy-four.
 *
 * Hence the reconciliation rather than a best effort. get_client_ar_total hands
 * back QuickBooks' own figure off its A/R ageing report and the caller refuses
 * to draw anything that does not tie to it. A statement that disagrees with
 * QuickBooks is worse than no statement -- the client checks it against their
 * own ledger, finds it wrong, and every later thing we say about the balance is
 * worth less.
 *
 * A statement also shows only what has been issued. Invoices here are created
 * about a week before they fall due and dated on the due date itself, so at any
 * moment QuickBooks holds several dated in the future. They belong on the
 * ladder and have no business on a statement headed "as at today". QuickBooks
 * agrees: its own ageing report leaves them out, which is why our totals
 * disagreed with it for nineteen clients until this filter went in.
 *
 * The full text of both functions is in the migrations applied to the database
 * as ar_statement_with_credits and ar_statement_dated_invoices_only.
 */
create or replace function public.get_client_ar_total(p_client_id uuid)
returns numeric
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
           a.total,
           coalesce(a.current, 0) + coalesce(a._1___30, 0) + coalesce(a._31___60, 0)
             + coalesce(a._61___90, 0) + coalesce(a._91_and_over, 0)
         )::numeric
    from public.get_client_quickbooks(true) l
    join public.qb_ar_aging_raw a on a.untitled = l.qb_customer_name
   where l.client_id = p_client_id
     and public.is_factur_user()
     and (public.has_permission('clients.health')
          or public.has_permission('finance.collections')
          or public.has_permission('org.manage'))
   limit 1;
$function$;

revoke all on function public.get_client_ar_total(uuid) from public, anon;
grant execute on function public.get_client_ar_total(uuid) to authenticated, service_role;
