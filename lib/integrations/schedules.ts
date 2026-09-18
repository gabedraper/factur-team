/**
 * What each scheduled job is for, in words.
 *
 * The Schedules table on the Integrations page reads the jobs themselves from
 * pg_cron on every load, so a job scheduled or removed by any session shows
 * up at once. Name, cron, state and the command it runs are all read live.
 *
 * What no machine can say is what the job means: which records it handles,
 * from where, to where, and on what criteria. That is written here, keyed on
 * the job's name. A job with no entry is flagged on the page as undescribed
 * rather than silently shown bare -- the same rule the page applies to a
 * staging table no integration claims.
 *
 * Adding a job? Add its entry here in the same migration.
 */

export type ScheduleAbout = {
  /** The kind of record it handles: "opportunities", "client contacts", "tickets". */
  records: string;
  /** Where they come from. */
  from: string;
  /** Where they end up. */
  to: string;
  /** Which ones, and how many: the window, the filter, the batch size. */
  criteria: string;
};

export const SCHEDULES: Record<string, ScheduleAbout> = {
  "agreements-sync": {
    records: "Completed PandaDoc agreements and the contract terms read from their PDFs.",
    from: "PandaDoc API.",
    to: "client_agreements and the client's terms; the client is matched by resolve_pandadoc_client().",
    criteria: "Newest completed documents first, at most 25 imports and 2 PDF reads per run, inside a 5-minute budget.",
  },
  "client-activity-counts": {
    records: "Activity counts per client account.",
    from: "raw_activities.",
    to: "client_activity_counts, rebuilt whole.",
    criteria: "Last 60 days, split into the last 30 (recent) and the 30 before (prior); rows with no account are skipped.",
  },
  "client-activity-months": {
    records: "Activities per client per month, and a percentile activity score.",
    from: "raw_activities joined to client_roster.",
    to: "client_activity_months and client_activity_rank, rebuilt whole.",
    criteria: "Last 6 months; the rank leaves out the current part-month, is computed within the service group, and is blank for groups under 5 clients.",
  },
  "client-commerce-months": {
    records: "Quote and order counts and totals per client per month.",
    from: "opp_quotes and opp_orders.",
    to: "client_commerce_months, rebuilt whole.",
    criteria: "Last 6 months, rows with a client only; an order is dated by PO date, then effective date, then when Salesforce created it.",
  },
  "client-contacts-sync": {
    records: "Client contact email addresses: primary, decision maker and billing.",
    from: "sf_clients_raw, and the newest QuickBooks invoice per client (falling back to the QuickBooks customer).",
    to: "client_contacts.",
    criteria: "Clients not marked Inactive, valid-looking addresses only; an existing contact's opt-out and bounce flags are never undone.",
  },
  "client-domains": {
    records: "Each client's email domain, used for its logo.",
    from: "sf_clients_raw: the explicit domain, then the decision maker's address, then the main contact's.",
    to: "org_clients.email_domain.",
    criteria: "Free-mail domains are skipped; only rows whose value actually changes are written; does nothing while Coupler is recreating the table.",
  },
  "client-lead-counts": {
    records: "Lead tallies per client: recent, prior, quoted, no quote, total, with a title.",
    from: "sf_opp_leads_raw.",
    to: "client_lead_counts, rebuilt whole.",
    criteria: "Last 30 days and the 30 before, by created date; quoted or not is read from the stage name.",
  },
  "client-lead-months": {
    records: "Delivered leads per client per month.",
    from: "sf_opp_leads_raw, backfilled from client_monthly_results where Coupler has nothing.",
    to: "client_lead_months, rebuilt whole.",
    criteria: "Last 6 months, only the delivered stage names, only clients on the roster; a client Coupler covers reads 0 rather than falling back.",
  },
  "client-performance": {
    records: "Per-client performance: quote turnaround, quote rate, win rate, email response time, DM involvement and a composite score.",
    from: "sf_opp_stage_changes_raw, sf_opp_leads_raw, raw_activities, client_quote_stats and client_roster.",
    to: "client_performance, rebuilt whole.",
    criteria: "Medians over stage changes (recorded from 2025-08-25) and send-to-reply activity pairs; an overlapping run is skipped, not stacked.",
  },
  "client-performance-snapshot": {
    records: "The six client performance measures, frozen for the month.",
    from: "client_performance joined to client_roster and org_clients.",
    to: "metric_snapshots, entity type client.",
    criteria: "That month's rows are deleted and re-inserted, so re-running it is safe; blank measures are not stored.",
  },
  "collections-state": {
    records: "Which clients have an overdue invoice, and since when.",
    from: "qb_invoices_raw, matched to clients through get_client_quickbooks().",
    to: "collections_client_state.",
    criteria: "Overdue means any invoice with a balance past its due date; overdue-since is the earliest such due date and is kept until nothing is overdue.",
  },
  "enrich-client-websites": {
    records: "A summary and company attributes read from each client's website.",
    from: "The client's own website, read and summarised by a model.",
    to: "client_attributes and client_profile.",
    criteria: "8 clients per run, pending ones with a website and under 3 attempts, fewest attempts first. Switched off unless ENRICH_ENABLED is set; currently off.",
  },
  "gaib-deliver-updates": {
    records: "Ticket notices, welcome messages for new starters, and queued outbox messages.",
    from: "gaib_ticket_notices, org_members and gaib_outbox.",
    to: "Google Chat: the room the ticket came from, or the person's direct message.",
    criteria: "Up to 40 undelivered notices, 5 new-starter greetings (members created in the last 14 days) and 10 outbox messages per run; marked sent only on success, so failures retry and nothing sends twice.",
  },
  "gaib-flag-stuck-tickets": {
    records: "Agent tickets that stopped moving.",
    from: "gaib_tickets.",
    to: "gaib_ticket_notices (status stuck) and gaib_ticket_events.",
    criteria: "Queued or running, untouched for 30 minutes, raised by someone, and not already flagged; fires once per ticket.",
  },
  "gaib-room-daily-test": {
    records: "The day's testing post for each Chat room that has a testing programme.",
    from: "gaib_rooms, with tickets shipped in the last 14 days and earlier gaib_room_tests.",
    to: "Google Chat rooms, recorded in gaib_room_tests.",
    criteria: "Weekdays only; a room that already has today's post is skipped.",
  },
  "gaib-room-read": {
    records: "New messages in every Chat room Gaib belongs to, and Gaib's replies.",
    from: "Google Chat API, rooms listed in gaib_rooms plus any newly found.",
    to: "gaib_rooms (last read, read status) and replies posted back to Chat.",
    criteria: "Per room, messages since the last read, or only the last 60 seconds on a first read; a 403 is recorded as awaiting admin approval rather than failing.",
  },
  "gaib-worker-poll": {
    records: "Agent worker turns that finished after their request ended, and idle workers.",
    from: "gaib_workers and the Anthropic Managed Agents API.",
    to: "Chat posts for finished turns; gaib_workers marked ended, with their sessions archived.",
    criteria: "Up to 50 running workers polled and 50 idle ones wound up per run; a worker is idle after 12 hours without activity; each turn is delivered once.",
  },
  "memory-sync": {
    records: "Company memory harvested from staff Google Drive and Chat.",
    from: "Google Workspace APIs, one pass per active member.",
    to: "The memory tables, with a cursor per account in memory_sync.",
    criteria: "Accounts taken stalest first, 45 seconds each inside a 270-second run; each resumes from its own cursor, so a cut-short run loses nothing.",
  },
  "nightly-maintenance": {
    records: "Activity mirrors, rep and manager records, new clients, and market-coverage rollups.",
    from: "The Coupler copies of Salesforce.",
    to: "raw_activities, deal activities, reps and managers, org_clients, market coverage and totals.",
    criteria: "Seven refreshes in sequence, every hour during the US working day despite the name; no overlap guard; 10-minute statement timeout.",
  },
  "pipeline-stage-counts": {
    records: "Per-client counts of target companies by stage band and pursuits by stage and lead status.",
    from: "opportunities joined to org_clients.",
    to: "pipeline_client_stage_counts and pipeline_client_field_counts, rebuilt whole.",
    criteria: "Clients not marked Inactive; a company counts at its highest stage; blank stage and lead-status values are left out; an overlapping run is skipped.",
  },
  "reapply-staging-rls": {
    records: "Row-level security and indexes on the Coupler staging tables, and a watermark of when Coupler last recreated them.",
    from: "The Postgres catalogue.",
    to: "The staging tables' own settings, and staging_sync_watermark.",
    criteria: "Puts back whatever a Coupler drop-and-recreate removed; the watermark moves only when a QuickBooks table's identity changed.",
  },
  "reconcile-opportunity-history": {
    records: "Field-by-field history of opportunities.",
    from: "opportunity_field_now.",
    to: "opportunity_history, source sync.",
    criteria: "Closes an open row only where the value differs and opens one only where none is open, so a repeat run writes nothing; an overlapping run is skipped.",
  },
  "refresh-client-aliases": {
    records: "Automatic short-name aliases for clients.",
    from: "sf_clients_raw names.",
    to: "client_aliases, the auto rows only; hand-written aliases are untouched.",
    criteria: "First two words of the name with legal suffixes stripped, kept if at least 5 characters, not starting with Factur, and matching exactly one client.",
  },
  "refresh-member-identities": {
    records: "Email addresses and Salesforce user ids that identify each member.",
    from: "org_members, reps and sf_users_raw.",
    to: "member_identities, source seed.",
    criteria: "Adds only, never removes; blank values and force.com addresses are skipped; Salesforce ids match on their first 15 characters.",
  },
  "resolve-activity-events": {
    records: "Inbound activity events waiting to be matched to a client and person.",
    from: "activity_events.",
    to: "Whatever resolve_activity_event() writes for each one, with its status updated.",
    criteria: "Up to 500 per run, pending or failed with under 5 attempts, oldest first; an overlapping run is skipped.",
  },
  "role-training-catch-up": {
    records: "Course enrolments that a person's role implies.",
    from: "org_assignments through role_courses to courses.",
    to: "enrollments.",
    criteria: "Active members who have signed in at least once, published courses only; an existing enrolment is left alone.",
  },
  "salesforce-catchup-nightly": {
    records: "Every Salesforce-derived app record: clients, members, campaigns, accounts, contacts, opportunities, activities, quotes, orders and commerce summaries.",
    from: "The Salesforce mirror tables already in the database.",
    to: "org_clients, org_members, crm_*, opportunities, opp_activities, opp_quotes, opp_orders.",
    criteria: "Re-reads the whole mirror, about 10 minutes, to catch rows whose client or contact arrived after the 3-minute pass had moved on; 60-minute timeout; all writes are upserts.",
  },
  "salesforce-reconcile": {
    records: "Record counts per object and stage, and deletions made in Salesforce.",
    from: "Salesforce counts compared with the app's own, plus records flagged deleted since the last check.",
    to: "salesforce_reconciliation, with deletions applied by apply_salesforce_deletions().",
    criteria: "Deletions since the previous check (30 days on the first run), at most 20,000 per object; each run adds a fresh snapshot rather than editing the last.",
  },
  "salesforce-sync": {
    records: "Raw Salesforce records for every object listed in salesforce_sync_objects, plus contacts missing from the mirror.",
    from: "Salesforce REST and SOQL.",
    to: "The per-object mirror tables, salesforce_contact_backfill, and watermarks in salesforce_sync_state.",
    criteria: "Fires every minute but each object runs only when its own interval has passed; rows modified since the object's watermark, capped per run, upserted in 500s; a lease stops two runs overlapping.",
  },
  "salesforce-transforms": {
    records: "The same app records as the nightly catch-up, but only what changed recently.",
    from: "The Salesforce mirror tables.",
    to: "org_clients, crm_*, opportunities and opp_* tables, plus the transforms watermark.",
    criteria: "Rows fetched since the watermark, less 5 minutes of deliberate overlap (1 hour on a first run); upserts make the overlap harmless; an overlapping run is skipped.",
  },
  "salesforce-writeback": {
    records: "Queued edits to opportunity fields, going back to Salesforce.",
    from: "salesforce_writeback_log.",
    to: "Salesforce opportunities, with the result written back to the log.",
    criteria: "Does nothing while write-back is switched off; up to 100 queued edits per run, each claimed first so two runs cannot send the same one; edits stuck in sending for 10 minutes are re-queued.",
  },
  "seal-exposed-tables": {
    records: "Public tables that Coupler recreated with row-level security off and access granted to anonymous users.",
    from: "The Postgres catalogue.",
    to: "The tables themselves, with a note in security_seal_log.",
    criteria: "Only tables that are both unprotected and granted to anon; logs only when it actually sealed something.",
  },
  "sync-clients-hourly": {
    records: "Clients new to the app.",
    from: "sf_clients_raw.",
    to: "org_clients: name, status and active flag.",
    criteria: "Adds a client whose Salesforce id is not yet present and whose name is not blank; never updates an existing row.",
  },
  "uptime-check": {
    records: "Probes of the app's own URL, and outage alerts.",
    from: "app_settings.uptime_url, fetched over HTTP.",
    to: "uptime_checks; an alert email through Resend.",
    criteria: "Settles the previous probe (200 to 399 is fine) then queues a new 15-second one; alerts when the last two checks both failed, once per outage.",
  },
  "vacuum-coupler-tables": {
    records: "Table statistics and visibility maps, not data.",
    from: "raw_activities, sf_opp_leads_raw, sf_opportunities_raw and sf_clients_raw.",
    to: "The same tables, in place.",
    criteria: "Vacuum with analyze, so Client Health's index-only scans stay inside the 8-second request timeout; an overlapping run is skipped.",
  },
  "work-access-sync": {
    records: "ClickUp people and who may see each list.",
    from: "ClickUp API: the team and each list's members.",
    to: "work_people, work_list_access and the work_containers they belong to.",
    criteria: "People re-linked every run; then the 60 lists checked longest ago, so the whole workspace is walked every four or five hours.",
  },
  "work-sync": {
    records: "ClickUp tasks with their assignees and dependencies, and any lists first seen.",
    from: "ClickUp API, tasks updated since the newest one already held.",
    to: "work_items, work_item_assignees, work_item_dependencies, work_containers, and a run row in work_sync_runs.",
    criteria: "Up to 10 pages of 100 tasks per run, subtasks and closed tasks included; 7-day window on a cold start; tasks key on their ClickUp id, so overlapping runs are harmless.",
  },
};

/**
 * The gist of a cron command, for the table.
 *
 * A job either posts to one of the app's routes or calls a SQL function
 * (sometimes through run_once, which only adds a lock). Either way the useful
 * part is a short name; the rest is headers and quoting.
 */
export function describeCommand(command: string | null | undefined): string {
  if (!command) return "";
  const s = command.replace(/\s+/g, " ").trim();

  const post = s.match(/net\.http_post\(\s*url := '([^']+)'/);
  if (post) {
    try {
      const u = new URL(post[1]);
      return `POST ${u.pathname}${u.search}`;
    } catch {
      return `POST ${post[1]}`;
    }
  }

  // run_once('name', 'select public.fn(...)') -- describe the inner statement.
  const inner = s.match(/run_once\(\s*'[^']*',\s*'((?:[^']|'')*)'\s*\)/);
  if (inner) return describeCommand(inner[1].replace(/''/g, "'"));

  if (/^vacuum\b/i.test(s)) {
    const tables = [...s.matchAll(/public\.(\w+)/g)].map((m) => m[1]);
    return `vacuum (analyze) ${tables.join(", ")}`;
  }

  const calls = [...new Set([...s.matchAll(/public\.(\w+)\(/g)].map((m) => `${m[1]}()`))];
  if (calls.length) return calls.join("; ");

  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/**
 * Cron, spelled out.
 *
 * Every shape the app actually schedules is covered; anything stranger is
 * shown as the expression itself rather than guessed at. Times are UTC
 * because that is what pg_cron runs in.
 */
export function cronInEnglish(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const pad = (n: string) => n.padStart(2, "0");
  const hhmm = (h: string, m: string) => `${pad(h)}:${pad(m)}`;
  const isNum = (v: string) => /^\d+$/.test(v);
  const list = (v: string) => v.split(",").map((x) => `:${pad(x)}`);
  const days = dow === "1-5" ? "weekdays" : dow === "*" ? "" : null;
  if (days === null || mon !== "*") return cron;

  if (dom === "*" && hour === "*") {
    if (min === "*") return "Every minute";
    const step = min.match(/^\*\/(\d+)$/);
    if (step) return `Every ${step[1]} minutes${days ? `, ${days}` : ""}`;
    if (isNum(min)) return `Hourly, at ${list(min)[0]}${days ? `, ${days}` : ""}`;
    if (/^[\d,]+$/.test(min)) {
      const at = list(min);
      const times = at.length === 2 ? "Twice" : `${at.length} times`;
      return `${times} an hour, at ${at.slice(0, -1).join(", ")} and ${at.at(-1)}${days ? `, ${days}` : ""}`;
    }
    return cron;
  }

  const range = hour.match(/^(\d+)-(\d+)$/);
  if (dom === "*" && range && isNum(min)) {
    return `Hourly, ${hhmm(range[1], min)}–${hhmm(range[2], min)} UTC${days ? `, ${days}` : ""}`;
  }

  if (isNum(min) && isNum(hour)) {
    if (dom === "*") return `${days ? "Weekdays" : "Daily"}, ${hhmm(hour, min)} UTC`;
    if (isNum(dom) && !days) {
      const d = Number(dom);
      const suffix = d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th";
      return `Monthly, the ${d}${suffix} at ${hhmm(hour, min)} UTC`;
    }
  }
  return cron;
}
