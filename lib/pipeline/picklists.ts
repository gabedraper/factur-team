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

/*
 * The ladder OSDR and OBDM work, which is what Target Contacts filters by.
 *
 * That screen shows the raw Salesforce stage on every row, so its filters have
 * to be those same values -- the rolled-up bands Target Companies reads belong
 * to the Factur salesperson's pipeline and name nothing a reader can see on the
 * rows underneath.
 *
 * A subset of ALL_STAGES rather than the lot: prospecting, Pipeline - Selling
 * and Sales Support are not stages this side of the house works, and Lead
 * Generated: Scheduled came off the list after it was first mapped out.
 */
export const TARGET_CONTACT_STAGES: string[] = [
  "Lead Generated", "Pipeline: Warm", "Pipeline: Hot",
  "Pipeline Hot: Client RFQ Review", "Pipeline Hot: Quote Follow up", "Pipeline Hot: Quoting",
  "Pipeline Hot: Supplier forms / NDA", "Pipeline Hot: Appointment set",
  "Pipeline: LT Follow Up",
  "Closed: Closed Won", "Closed: Closed Lost", "Closed: DQ Contact", "Closed: DQ Company", "Closed: No Quote",
];

export const LEAD_STATUSES: string[] = [
  "Pipeline - Cold", "Pipeline - Warm SDR", "Pipeline - Warm", "Pipeline - Selling",
  "Closing", "LTFU", "Lost Follow Up", "Customer", "Relationship", "No Fit Ever - Contact", "No Fit Ever - Account",
];
