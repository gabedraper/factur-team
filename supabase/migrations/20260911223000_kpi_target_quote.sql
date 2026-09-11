/*
 * The sentence a target came from.
 *
 * A KPI is only recorded where the agreement commits to a number, and the
 * reading already refuses a target with no sentence behind it -- but the
 * sentence was then thrown away, so a figure on the client record could not be
 * checked against the contract without opening the PDF. That is how a target
 * read from a ramping promise ("10 a quarter, then 13, then 15") sat on a
 * client as a flat 5 a month with nothing to show where it came from.
 *
 * Empty on anything a person typed: their own figure is not a quotation.
 */
alter table public.client_kpi_targets
  add column if not exists quote text;
