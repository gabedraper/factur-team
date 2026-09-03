/*
 * Two things, both applied already; recorded here so the repository matches.
 *
 * run_once(job, sql) -- a transaction-level advisory lock so a scheduled job
 * can never run twice at once. On 3 September record_opportunity_history was on
 * a one-minute schedule and taking up to eight, so each run started before the
 * last finished, every one holding a connection, until there were none left.
 * Six hundred refusals in twenty-five minutes. Lengthening the schedule treats
 * the symptom; this is the rule.
 *
 * gaib_ticket_questions -- a question about a ticket and the answer to it,
 * carried by Gaib in both directions. Deciding whether to build something
 * usually needs one more sentence from the person who asked, and finding them,
 * remembering the context and asking on Chat is enough friction that the ticket
 * gets judged on the first description instead.
 */
