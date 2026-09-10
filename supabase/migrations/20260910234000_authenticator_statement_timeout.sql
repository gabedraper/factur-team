/*
 * PostgREST could not load its schema cache, and while it cannot, every
 * REST call answers 503 PGRST002 -- the whole app, for everyone.
 *
 * The load runs as `authenticator`, which carried statement_timeout = 8s.
 * One of its queries, `select name from pg_timezone_names`, reads hundreds
 * of zoneinfo files from disk; on 2026-09-10 it averaged 0.7s and peaked
 * past 8s as the instance's disk IO ran short, so the load was cancelled on
 * every attempt from 20:49 UTC. Each Coupler sync (hourly, :03) recreates
 * its tables and forces another attempt.
 *
 * The limit here only governs PostgREST's own housekeeping. Requests still
 * run under the impersonated role -- anon at 3s, authenticated at 8s --
 * because PostgREST applies that role's settings per transaction.
 */
alter role authenticator set statement_timeout = '60s';
alter role authenticator set lock_timeout = '30s';

notify pgrst, 'reload schema';
