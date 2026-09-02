/*
 * When the PDF itself was read, as opposed to its merge fields.
 *
 * Both passes write terms marked as coming from the contract, so the source
 * column cannot tell them apart -- and the reading pass exists precisely for
 * the documents the merge fields could not answer for. Tracking it per document
 * rather than per client also keeps a renewal from being skipped because an
 * earlier agreement for the same client was already read.
 */
alter table public.client_agreements
  add column if not exists pdf_read_at timestamptz,
  add column if not exists pdf_read_problem text;
