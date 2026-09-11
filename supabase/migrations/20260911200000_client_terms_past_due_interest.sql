/*
 * Past due interest: what a client's contract says they pay on a late invoice.
 *
 * The rate alone is not enough to act on. The standard agreement says 1.5% per
 * month, one says 8% per year -- eighteen against eight once annualised -- so
 * the period sits beside it. The days are when it starts (30 after the invoice
 * on most, 60 or 10 on a few), and the clause is the sentence itself, so
 * anybody writing to a client about it can quote the contract rather than a
 * number somebody typed.
 *
 * Zero and empty mean different things. Zero is a contract that says "no
 * interest shall accrue"; empty is one that says nothing, or no contract at
 * all.
 *
 * The agreement it came from is kept separately from client_terms.agreement_id:
 * a renewal usually restates the price but not the payment clause, so the rate
 * often comes from an older document than the rest of the terms.
 */
alter table public.client_terms
  add column if not exists past_due_interest_pct numeric
    check (past_due_interest_pct >= 0 and past_due_interest_pct <= 100),
  add column if not exists past_due_interest_period text
    check (past_due_interest_period in ('month', 'year')),
  add column if not exists past_due_interest_after_days integer
    check (past_due_interest_after_days >= 0),
  add column if not exists past_due_interest_clause text,
  add column if not exists past_due_interest_agreement_id uuid
    references public.client_agreements(id) on delete set null;
