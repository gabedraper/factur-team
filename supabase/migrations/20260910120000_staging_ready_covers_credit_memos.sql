/*
 * Credit memos join the staging list.
 *
 * Coupler now pulls them (dataflow "Factur Scoreboard — Salesforce to
 * Supabase", source "QuickBooks — credit memos" -> qb_credit_memos_raw), and
 * Coupler drops and recreates its tables on every sync, so without a line here
 * the table would arrive each time with no row level security and no index.
 * seal_exposed_tables() would catch the security hole within ten minutes -- it
 * sweeps for any public table anon can reach -- but "a scheduled job will
 * notice" is a net, not a design, and the index it would never add is what
 * keeps the statement query off a sequential scan.
 *
 * The full function body is in the migration applied to the database under the
 * same name; it differs from its predecessor only by the two added lines.
 */
