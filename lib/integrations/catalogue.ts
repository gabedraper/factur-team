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

/**
 * The tools themselves -- one card each on the Integrations page. A tool can
 * have several connections (Salesforce reads through Coupler and through the
 * app's own sync, and writes back through a third path); the card is where a
 * person looks for all of them, and where its settings live.
 */
export type Tool = {
  key: string;
  name: string;
  /** For the logo -- the favicon service reads it. */
  domain: string;
  what: string;
};

export const TOOLS: Tool[] = [
  { key: "salesforce", name: "Salesforce", domain: "salesforce.com",
    what: "The CRM: opportunities, companies, contacts, quotes, orders and the activity against them." },
  { key: "google", name: "Google Workspace", domain: "workspace.google.com",
    what: "Mail, chat and meetings read for context; mail sent for collections, NPS and outreach." },
  { key: "quickbooks", name: "QuickBooks", domain: "quickbooks.intuit.com",
    what: "Invoices, payments and what customers owe." },
  { key: "dialpad", name: "Dialpad", domain: "dialpad.com",
    what: "Click-to-dial and the numbers calls go out on." },
  { key: "clickup", name: "ClickUp", domain: "clickup.com",
    what: "The work: tasks, their owners and their state, mirrored for the Work section." },
  { key: "pandadoc", name: "PandaDoc", domain: "pandadoc.com",
    what: "Signed agreements, read so contract terms sit on the client." },
];

export const TOOL_BY_KEY = new Map(TOOLS.map((t) => [t.key, t]));

export type Integration = {
  key: string;
  /** Which tool's card this connection belongs to. */
  tool: string;
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
    tool: "salesforce",
    name: "Salesforce — Coupler report copy",
    what:
      "An older copy of a few Salesforce reports, refreshed hourly. Client health, the " +
      "client Leads and Activities pages and Gaib still read it; the Opportunities pages " +
      "and Timelines moved to the app's own sync below.",
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
      href: "/integrations/salesforce#accounts",
      label: "Salesforce accounts",
      what: "Match people to their Salesforce user so activity is attributed correctly.",
    },
  },
  {
    key: "quickbooks",
    tool: "quickbooks",
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
      href: "/integrations/quickbooks",
      label: "QuickBooks customers",
      what: "Tie customers who owe money to the right client, where the names differ.",
    },
  },
  {
    key: "google-ingest",
    tool: "google",
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
      href: "/integrations/google",
      label: "Google Workspace",
      what: "Check the connection, and read a mailbox on demand.",
    },
  },
  {
    key: "google-send",
    tool: "google",
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
      href: "/integrations/google",
      label: "Google Workspace",
      what: "Check which addresses have been granted permission to send.",
    },
  },
  {
    key: "salesforce-sync",
    tool: "salesforce",
    name: "Salesforce — sync and write-back",
    what:
      "The app's own copy of Salesforce, and the one path that writes back. Every " +
      "minute /api/salesforce/sync asks Salesforce what changed and copies it into the " +
      "sky_* mirror tables; every three minutes SQL transforms turn the mirror into the " +
      "tables the app reads. Edits made in the app by the people on the write-back list " +
      "are pushed to Salesforce, field by field, and read back to check they landed.",
    direction: "both",
    transport:
      "A Connected App with the Client Credentials flow, acting as its Run As user -- so " +
      "what it can see is what that user can see. Reads by LastModifiedDate past each " +
      "object's watermark, at most a set number of rows per run; the objects, fields and " +
      "frequency are settings, below. An hourly reconciliation counts Salesforce against " +
      "the mirror against the app, and learns deletions.",
    tables: ["opportunities", "crm_accounts", "crm_contacts", "opp_activities", "opp_quotes", "opp_orders"],
    excluded: [
      "Prospecting: Cold Call List opportunities stay in Salesforce -- a list is not a pursuit of anyone yet.",
      "Companies and contacts come in only; they are read-only in the app on purpose.",
      "Six opportunity fields go back (stage, lead status, notes, updates, next action, company); " +
      "the reached flags and close date do not, because Salesforce's own automation owns them.",
    ],
    feeds: ["Opportunities", "Timelines", "Target companies and contacts", "Quotes and POs", "The header search"],
    ownedBy: "RevOps",
  },
  {
    key: "dialer",
    tool: "dialpad",
    name: "Dialpad Mini Dialer",
    what:
      "Click-to-dial from Opportunities and the target lists. Dialpad's Mini Dialer is " +
      "embedded in the work panel and places calls as whoever is logged into it. " +
      "Twilio and Telnyx were tried and removed; Dialpad is the only dialer.",
    direction: "out",
    transport:
      "An embedded iframe (Mini Dialer/CTI), driven client-side with window.postMessage — " +
      "see components/pipeline/DialWidget.tsx. No server involved. The one thing that's ours " +
      "is which reserved number presents as caller ID, picked from voice_numbers before each call.",
    tables: ["voice_numbers"],
    excluded: [
      "No call-duration/recording webhook — a call's outcome is " +
      "whatever the rep dispositions by hand into opp_activities.",
      "Numbers aren't purchased or reserved here — that still happens in Dialpad. " +
      "This only tracks the pool already bought, for rotation.",
    ],
    feeds: ["Opportunity activity timeline"],
    ownedBy: "RevOps",
    configure: {
      href: "/integrations/dialpad",
      label: "Dialer",
      what: "The outbound number pool, and whether the Dialpad Mini Dialer is wired up.",
    },
  },
  {
    key: "clickup",
    tool: "clickup",
    name: "ClickUp — work",
    what:
      "Tasks, lists and who is on them, so the Work section and each client's work panel " +
      "show what is actually in flight without opening ClickUp.",
    direction: "in",
    transport:
      "/api/work/sync every fifteen minutes through the ClickUp API, and " +
      "/api/work/access-sync four times an hour to keep who-can-see-what in step with " +
      "ClickUp's own sharing.",
    tables: [
      "work_items", "work_item_details", "work_item_assignees", "work_item_dependencies",
      "work_containers", "work_processes", "work_sync_runs",
    ],
    excluded: [
      "Read only. Nothing here changes a task in ClickUp.",
      "Private spaces are not shown to everyone -- access follows ClickUp's sharing.",
    ],
    feeds: ["Work", "Client work panels", "The home page"],
    ownedBy: "Operations",
  },
  {
    key: "pandadoc",
    tool: "pandadoc",
    name: "PandaDoc — signed agreements",
    what:
      "Signed contracts, imported and tied to the right client, with the terms read out " +
      "of the PDF so late-payment interest and the rest sit on the client record.",
    direction: "in",
    transport:
      "/api/agreements/sync every ten minutes through the PandaDoc API; each new agreement's " +
      "PDF is read once for its terms.",
    tables: ["client_agreements", "client_terms"],
    excluded: [
      "Read only. Documents are made and sent in PandaDoc.",
    ],
    feeds: ["Client agreement panel", "Collections terms", "Past-due interest"],
    ownedBy: "Finance",
    configure: {
      href: "/integrations/pandadoc",
      label: "Signed agreements",
      what: "Bring contracts in from PandaDoc and tie them to the right client.",
    },
  },
];

/** Every table the catalogue claims, for checking against what the database holds. */
export function catalogued(): Set<string> {
  return new Set(INTEGRATIONS.flatMap((i) => i.tables));
}
