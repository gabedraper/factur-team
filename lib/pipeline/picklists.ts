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

export const LEAD_STATUSES: string[] = [
  "Pipeline - Cold", "Pipeline - Warm SDR", "Pipeline - Warm", "Pipeline - Selling",
  "Closing", "LTFU", "Lost Follow Up", "Customer", "Relationship", "No Fit Ever - Contact", "No Fit Ever - Account",
];

/*
 * The stages a board draws, in the order a deal moves through them.
 *
 * Not every stage, because a board is the live pipeline: the Closed family is
 * an archive and a client can carry tens of thousands of it, and the
 * Prospecting family is sourcing rather than a pursuit -- the same family the
 * lead counts already leave out.
 *
 * Pipeline: LT Follow Up is live work, but it is parked work and there is far
 * more of it than anything else -- 365 of Riverside's 419 open deals, against
 * 54 in the stages a call actually gets prepared from. As a column on the
 * board it buries the rest, so it is one you switch on rather than land on.
 */
export const BOARD_STAGES: string[] = [
  "Pipeline: Warm", "Pipeline: Hot", "Pipeline Hot: Appointment set",
  "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Quoting", "Pipeline Hot: Quote Follow up",
  "Pipeline Hot: Supplier forms / NDA", "Pipeline - Selling", "Sales Support",
];

export const LTFU_STAGE = "Pipeline: LT Follow Up";
