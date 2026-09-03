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
      "The record of opportunities, accounts and the activity logged against them, " +
      "mirrored for reporting. This particular connection reads and never writes " +
      "back -- see the separate Skyvia connection below for the one that does.",
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
  {
    key: "skyvia",
    name: "Skyvia — pipeline",
    what:
      "The one connection that writes into Salesforce. Opportunities are edited " +
      "here now, not there, and the pursuit of a Contact by a Client needs to stay " +
      "true in both places while people transition off Salesforce for day-to-day work.",
    direction: "both",
    transport:
      "Skyvia polls roughly once a minute, both directions. Writes to Salesforce " +
      "authenticate as a dedicated integration user with a Disable_Triggers_On_Objects__c " +
      "override on System_Settings__c, so Salesforce's own automation (naming, emails, " +
      "contact-role upserts) doesn't fire a second time on a sync-originated write.",
    tables: ["opportunities", "crm_accounts", "crm_contacts"],
    excluded: [
      "Only worked Opportunities sync — Prospecting: Cold Call List rows stay in " +
      "Salesforce untouched; they aren't a pursuit of anyone yet.",
      "Accounts and Contacts sync in only. They're read-only in the app on purpose.",
      "Client name/status now sync both ways -- a deliberate exception to the " +
      "insert-only rule sync_clients_from_salesforce() otherwise holds to, so a " +
      "Salesforce-side edit can now overwrite one made here.",
    ],
    feeds: ["The pipeline", "Rep-collision review"],
    ownedBy: "RevOps",
  },
  {
    key: "dialer",
    name: "Dialer — Telnyx / Twilio / Dialpad Mini Dialer",
    what:
      "Click-to-dial on an Opportunity. Three providers exist because the first two hit " +
      "external walls: Dialpad's Mini Dialer needs an approval that's still pending, and " +
      "Twilio's own account signup couldn't deliver a 2FA code after repeated tries. " +
      "Telnyx and Twilio both hold a real WebRTC call in the rep's browser, authenticated " +
      "by a token this app issues per call/rep; Dialpad's Mini Dialer instead posts " +
      "messages into Dialpad's own iframe, using whoever is logged into it. Whichever " +
      "provider has its env vars set wins — see app/(dashboard)/opportunities/" +
      "[opportunityId]/page.tsx.",
    direction: "out",
    transport:
      "Telnyx: app/api/telnyx/voice, TeXML, Ed25519-signature-verified (TELNYX_PUBLIC_KEY). " +
      "Twilio: app/api/twilio/voice, TwiML, HMAC-signature-verified (TWILIO_AUTH_TOKEN). Both " +
      "are the one server-side piece each provider's servers call when a rep's browser " +
      "starts a call, returning the XML that bridges to the destination number. Dialpad: " +
      "an embedded iframe (Mini Dialer/CTI), driven client-side with window.postMessage, " +
      "no server involved. Across all three, the one thing that's ours is which reserved " +
      "number presents as caller ID, picked from voice_numbers before each call.",
    tables: ["voice_numbers"],
    excluded: [
      "No call-duration/recording webhook yet for any provider — a call's outcome is " +
      "whatever the rep dispositions by hand into opp_activities.",
      "Numbers aren't purchased or reserved here — that still happens on the provider's " +
      "own console. This only tracks the pool already bought, for rotation.",
    ],
    feeds: ["Opportunity activity timeline"],
    ownedBy: "RevOps",
    configure: {
      href: "/settings/dialpad",
      label: "Dialer",
      what: "The outbound number pool, and whether Twilio or the Dialpad Mini Dialer is wired up.",
    },
  },
];

/** Every table the catalogue claims, for checking against what the database holds. */
export function catalogued(): Set<string> {
  return new Set(INTEGRATIONS.flatMap((i) => i.tables));
}
