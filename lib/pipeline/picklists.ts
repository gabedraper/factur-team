/*
 * Salesforce's actual Opportunity picklists, read from the org's field
 * metadata rather than guessed. Skyvia syncs opportunities both ways, so a
 * stage or lead status the app writes has to be one Salesforce will accept
 * -- these are shared between the editor (what a value can be set to) and
 * the pipeline list (what it can be filtered by), so the two can't drift.
 */

export const STAGE_GROUPS: { label: string; values: string[] }[] = [
  {
    label: "Prospecting",
    values: [
      "Prospecting: Pipeline Cold", "Prospecting: Cold Call List", "Prospecting: Cold Referral",
      "Prospecting: Warm Referral", "Prospecting: Referred", "Lead Generated", "Lead Generated: Scheduled",
    ],
  },
  {
    label: "Pipeline",
    values: [
      "Pipeline: Warm", "Pipeline: Hot", "Pipeline: LT Follow Up", "Pipeline - Selling",
      "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Quote Follow up", "Pipeline Hot: Quoting",
      "Pipeline Hot: Supplier forms / NDA", "Pipeline Hot: Appointment set",
    ],
  },
  {
    label: "Closed",
    values: ["Closed: Closed Won", "Closed: Closed Lost", "Closed: DQ Contact", "Closed: DQ Company", "Closed: No Quote"],
  },
  { label: "Other", values: ["Sales Support"] },
];

export const ALL_STAGES: string[] = STAGE_GROUPS.flatMap((g) => g.values);

/* Closed means the deal has left the pipeline, so the board draws none of it. */
export const CLOSED_STAGES: string[] =
  STAGE_GROUPS.find((g) => g.label === "Closed")!.values;

/*
 * The stages the board draws as columns, in the order a deal moves through
 * them -- the six an account manager actually works.
 */
export const BOARD_STAGES: string[] = [
  "Pipeline: Warm", "Sales Support", "Pipeline: Hot",
  "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Quote Follow up",
  "Pipeline Hot: Supplier forms / NDA",
];

/*
 * Deals parked for the long term. Not a column: at Riverside there are 365 of
 * them against 54 live ones, so a column for it is the board. It sits below
 * the columns as a section that opens, with its size on the heading.
 */
export const NURTURE_STAGE = "Pipeline: LT Follow Up";

export const LEAD_STATUSES: string[] = [
  "Pipeline - Cold", "Pipeline - Warm SDR", "Pipeline - Warm", "Pipeline - Selling",
  "Closing", "LTFU", "Lost Follow Up", "Customer", "Relationship", "No Fit Ever - Contact", "No Fit Ever - Account",
];
