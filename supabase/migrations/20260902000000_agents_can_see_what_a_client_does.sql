/*
 * The team's own classification of what a client does, opened to agents.
 *
 * Without it, asked how we had performed for injection moulders, Gaib matched
 * client names against the words mold, injection and plastic. That found 31
 * names, about 10 with figures, and silently missed every moulder whose name
 * does not say so. It reported the method honestly, which is to its credit, and
 * it is still the wrong answer to the question a BDM is actually asking before
 * a call.
 *
 * client_roster.type_of_work is the real answer: 22 values curated by hand,
 * filled in for 883 of 987 clients, with injection moulding split into two
 * categories by volume and precision. client_monthly_results is how those
 * clients then performed, counted into the month of the engagement rather than
 * the calendar month -- which is what makes "how did clients like this do in
 * their first quarter" a question with an answer.
 *
 * The allowlist inside gaib_query and gaib_describe gains those, plus the
 * cohorts view that resolves the two together.
 */

/*
 * The view ran with its owner's rights, so row level security did not apply to
 * anything read through it.
 *
 * Both tables underneath allow any signed-in member of staff, so this widens
 * nothing today. But a view that ignores policies will go on ignoring a
 * stricter policy somebody adds later, and will do it quietly -- which is the
 * whole reason the advisor flags them.
 */
alter view public.client_cohorts set (security_invoker = true);

-- The two functions are recreated with the wider allowlist. Their bodies are
-- otherwise unchanged; see the migrations that introduced them for why each
-- guard is there.

-- Corrected after the fact: the table is client_profile, singular. A name in
-- the allowlist that does not exist grants nothing, so nothing was exposed --
-- but an agent would have kept asking for a table that is not there and been
-- told it was unavailable, which is a confusing way to say "misspelled".
--
-- Worth knowing about that table: it has one row per client of what their
-- website says they do, and it is empty. 940 of 987 clients have a website
-- address on file and none of them have been read. Until something fills it,
-- an agent knows where a client's site is and nothing about what is on it.
