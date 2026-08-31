/**
 * What each connection is for, in the words of whoever built it.
 *
 * This file is deliberately small. Everything that can be read from the
 * running system -- the schedules, the row counts, the scopes, the Gmail
 * search, the last error -- is read from the running system, because a page
 * that restates what the code does drifts from it within a month and then
 * quietly misinforms everybody who trusts it.
 *
 * What is left here is the part no machine can answer: why a connection
 * exists, what is deliberately excluded, and who notices when it breaks.
 *
 * Adding a table? Put it in `tables` below. A staging table the database has
 * and this file does not is reported on the page as undocumented rather than
 * silently omitted -- see `undocumentedTables` in actions/integrations.ts.
 * That is the only thing keeping this honest as the app grows.
 */

export type Direction = "in" | "out" | "both";

export type Integration = {
  key: string;
  name: string;
  /** What it is, in a sentence somebody outside the team would follow. */
  what: string;
  direction: Direction;
  /** How data actually moves. Named so a reader knows where to look next. */
  transport: string;
  /** Staging or destination tables this connection owns. */
  tables: string[];
  /** What is deliberately left out, and why. */
  excluded: string[];
  /** What breaks downstream when this stops. */
  feeds: string[];
  /** Who to tell. */
  ownedBy: string;
  /*
   * Where this connection is configured, when there is somewhere.
   *
   * Kept beside the description of the connection rather than in a list of
   * settings cards: the question "how is Salesforce wired up" and the question
   * "where do I fix the wiring" are the same question, and they were two
   * screens apart.
   */
  configure?: { href: string; label: string; what: string };
};

export const INTEGRATIONS: Integration[] = [
  {
    key: "salesforce",
    name: "Salesforce",
    what:
      "The record of opportunities, accounts and the activity logged against them. " +
      "Salesforce is the source of truth for anything to do with selling; the app " +
      "reads it and never writes back.",
    direction: "in",
    transport:
      "Coupler.io copies whole tables on a schedule. Each sync drops the table and " +
      "recreates it, which is why row-level security, indexes and statistics are " +
      "reapplied afterwards by ensure_staging_ready().",
    tables: [
      "sf_opportunities_raw",
      "sf_opp_leads_raw",
      "sf_opp_tasks_raw",
      "sf_opp_stage_changes_raw",
      "sf_clients_raw",
      "sf_users_raw",
      "sf_tasks_raw",
      "sf_events_raw",
      "sf_orders_raw",
    ],
    excluded: [
      "Stage history starts June 2024 — nothing before that was recorded in a form the app can read.",
      "Only current clients are mirrored, so a client that has left stops appearing rather than showing as lost.",
    ],
    feeds: [
      "Opportunity timelines",
      "Scoreboards",
      "Client health",
    ],
    ownedBy: "RevOps",
    configure: {
      href: "/settings/salesforce",
      label: "Salesforce accounts",
      what: "Match people to their Salesforce user so activity is attributed correctly.",
    },
  },
  {
    key: "quickbooks",
    name: "QuickBooks",
    what:
      "Invoices, payments and the ageing of what customers owe. Everything the " +
      "collections process decides is based on these figures.",
    direction: "in",
    transport: "Coupler.io, on the same drop-and-recreate basis as Salesforce.",
    tables: [
      "qb_invoices_raw",
      "qb_payments_raw",
      "qb_customers_raw",
      "qb_ar_aging_raw",
    ],
    excluded: [
      "Only customers, not suppliers or the general ledger.",
    ],
    feeds: [
      "Collections queue and chase sequences",
      "Client health receivables score",
    ],
    ownedBy: "Finance",
    configure: {
      href: "/settings/quickbooks",
      label: "QuickBooks customers",
      what: "Tie customers who owe money to the right client, where the names differ.",
    },
  },
  {
    key: "google-ingest",
    name: "Google Workspace — reading",
    what:
      "Reads billing correspondence, chat and meeting transcripts for the accounts " +
      "on the ingest list, so a client record shows what was actually said and when.",
    direction: "in",
    transport:
      "A service account with domain-wide delegation borrows a read token for each " +
      "person in turn. It holds no mailbox of its own. Runs one account per request, " +
      "driven from the Google settings page, because a whole domain in one request " +
      "outran the function timeout.",
    tables: ["comm_messages", "ingest_runs"],
    excluded: [
      "Message bodies are never stored — headers and Gmail's own one-line snippet only.",
      "Mail is matched on subject rather than full text, so sales threads that merely mention money stay out.",
      "Conversations only between Factur addresses are dropped; something has to involve a client to be worth keeping.",
    ],
    feeds: ["The conversation trail on a client", "Collections context"],
    ownedBy: "Operations",
    configure: {
      href: "/settings/google",
      label: "Google Workspace",
      what: "Check the connection, and read a mailbox on demand.",
    },
  },
  {
    key: "google-send",
    name: "Google Workspace — sending",
    what:
      "The only connection that puts something in front of a customer. Collections " +
      "chases, NPS invitations and talent outreach are composed here and either left " +
      "as a draft or sent, depending on the mode each process is set to.",
    direction: "out",
    transport:
      "The same service account, with gmail.compose granted per address in the Google " +
      "Admin console. Until an admin grants it for an address, every send from that " +
      "address is refused.",
    tables: ["collections_sent", "sequence_runs"],
    excluded: [
      "Nothing is sent automatically without a person pressing send unless that sequence is set to full mode.",
    ],
    feeds: ["Collections", "NPS", "Talent outreach"],
    ownedBy: "Operations",
    configure: {
      href: "/settings/google",
      label: "Google Workspace",
      what: "Check which addresses have been granted permission to send.",
    },
  },
];

/** Every table the catalogue claims, for checking against what the database holds. */
export function catalogued(): Set<string> {
  return new Set(INTEGRATIONS.flatMap((i) => i.tables));
}
