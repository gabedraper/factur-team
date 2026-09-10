/*
 * The invoice register, and the ACH worklist inside it.
 *
 * Breno needs one page that answers, for every invoice: when was it raised,
 * when did it go out, when is it due, when was it paid. And inside that, the
 * part she does by hand -- clients whose bank details we hold and whose payment
 * she has to go and take -- needs two more answers: what do I run today, and
 * did I already run this one.
 *
 * That second question is the whole reason ar_ach_runs exists. Money she has
 * taken does not reach our copy of QuickBooks for minutes or hours, and an
 * invoice that still reads unpaid is exactly what makes somebody charge a
 * customer twice. The mark bridges that gap and then gets out of the way: once
 * the balance clears the row leaves the worklist, marked or not.
 *
 * ar_client_settings.collect_method says who collects -- 'we_charge' is the one
 * that generates work. It is seeded from payment history where the history says
 * so plainly (a reference reading "ACH ON FILE", or a majority of payments
 * whose source is EInvoice) and left null otherwise. Null shows as Unknown on
 * the screen rather than being filed under "they pay", because the cost of that
 * particular wrong guess is an invoice nobody ever collects. 116 open invoices
 * are in that state today.
 *
 * invoice_payment_dates() parses line_linkedtxn, which Coupler lands as one
 * JSON array per payment line with the lines joined by carriage returns. The
 * flat linkedtxn_txnid column beside it does not point at invoices at all --
 * it matches none of them -- so this is the only route to a payment date.
 *
 * The full function bodies are in the migration applied to the database under
 * the same name.
 */
