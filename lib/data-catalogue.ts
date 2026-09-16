/*
 * What the app holds, in the words of the business rather than the schema.
 *
 * Salesforce's Object Manager is one screen listing every object with its
 * record count and a way in, and people who have used it know what the system
 * knows without asking anybody. This is the same idea over our own tables.
 *
 * It is a chosen list, not a reflection of the database. There are about 150
 * tables in there and most are plumbing -- the sky_* and sf_*_raw sync mirrors
 * that Coupler drops and rebuilds, vector stores, job queues, audit trails.
 * Listing those would bury the fifteen tables somebody might actually want, and
 * naming them here would promise a stability the mirrors do not have.
 *
 * `table` is the real table, shown on screen and used for the row estimate, so
 * this page doubles as the map between what a thing is called in conversation
 * and what it is called in the database. Adding a dataset means adding a line
 * here; the count and the link come for free.
 */

export type Dataset = {
  label: string;
  /** What it holds, in a sentence somebody outside engineering would use. */
  description: string;
  /** The real table, for the row estimate and for anyone writing a query. */
  table: string;
  /** Where to browse it, where there is somewhere to browse it. */
  href?: string;
  group: string;
};

export const DATA_GROUPS = ["Clients", "Sales", "Money", "Talent", "Work", "Market"] as const;

export const DATASETS: Dataset[] = [
  {
    group: "Clients",
    label: "Clients",
    description: "Every company we have worked for, live or long gone, and who looks after them.",
    table: "org_clients",
    href: "/data/clients",
  },
  {
    group: "Clients",
    label: "Service periods",
    description: "One row per stint a client spent on a service. Overlaps are legitimate.",
    table: "client_service_periods",
  },
  {
    group: "Clients",
    label: "Monthly results",
    description: "What each client was delivered, month by month, split by the service that produced it.",
    table: "client_monthly_results",
    href: "/clients/results",
  },
  {
    group: "Clients",
    label: "Agreements",
    description: "Signed contracts imported from PandaDoc.",
    table: "client_agreements",
  },
  {
    group: "Clients",
    label: "Contract terms",
    description: "What each agreement says: the fee, the term, the notice, the late-payment interest.",
    table: "client_terms",
  },
  {
    group: "Clients",
    label: "Client contacts",
    description: "The people at a client we deal with.",
    table: "client_contacts",
  },
  {
    group: "Clients",
    label: "What clients make",
    description: "Facts about a client's business, read from their own website.",
    table: "client_attributes",
  },

  {
    group: "Sales",
    label: "Opportunities",
    description: "Every lead raised for a client, at whatever stage it reached.",
    table: "opportunities",
    href: "/opportunities/my",
  },
  {
    group: "Sales",
    label: "Companies",
    description: "Prospect companies, the ones we approach on a client's behalf.",
    table: "crm_accounts",
    href: "/data/companies",
  },
  {
    group: "Sales",
    label: "People",
    description: "Contacts at those companies.",
    table: "crm_contacts",
    href: "/data/people",
  },
  {
    group: "Sales",
    label: "Opportunity activity",
    description: "Calls, emails and meetings logged against an opportunity.",
    table: "opp_activities",
  },
  {
    group: "Sales",
    label: "Stage history",
    description: "Every stage an opportunity moved through, and when.",
    table: "opportunity_history",
  },
  {
    group: "Sales",
    label: "Campaign members",
    description: "Who was on which campaign.",
    table: "crm_campaign_members",
  },

  {
    group: "Money",
    label: "Invoices",
    description: "QuickBooks invoices, including what is still owed on them.",
    table: "qb_invoices_raw",
    href: "/collections",
  },
  {
    group: "Money",
    label: "Payments",
    description: "QuickBooks payments received.",
    table: "qb_payments_raw",
  },
  {
    group: "Money",
    label: "Billing customers",
    description: "QuickBooks customers, which are matched to clients by name.",
    table: "qb_customers_raw",
  },

  {
    group: "Talent",
    label: "Candidates",
    description: "People in a hiring pipeline for one of our jobs.",
    table: "tal_candidates",
    href: "/talent/people",
  },
  {
    group: "Talent",
    label: "Talent pool",
    description: "Everyone we have sourced, whether or not they went anywhere.",
    table: "tal_people",
  },
  {
    group: "Talent",
    label: "Jobs",
    description: "Roles we are recruiting for.",
    table: "tal_jobs",
    href: "/talent/jobs",
  },

  {
    group: "Work",
    label: "Work items",
    description: "Tasks synced from ClickUp.",
    table: "work_items",
    href: "/work",
  },
  {
    group: "Work",
    label: "Spaces and lists",
    description: "The ClickUp containers those tasks live in.",
    table: "work_containers",
    href: "/work/browse",
  },

  {
    group: "Market",
    label: "Industries",
    description: "NAICS industry codes, the backbone of market sizing.",
    table: "naics_industries",
  },
  {
    group: "Market",
    label: "Establishments",
    description: "How many firms exist per industry and area, from the Census.",
    table: "naics_establishments",
  },
  {
    group: "Market",
    label: "Client market coverage",
    description: "How much of a client's addressable market we have reached.",
    table: "client_market_coverage",
  },
];

export const DATASET_TABLES = DATASETS.map((d) => d.table);
