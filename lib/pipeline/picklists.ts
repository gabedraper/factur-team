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
  /*
   * Client-led: the prospect is being carried by our client rather than by
   * Factur. It happens both before a quote and after one, so it sits between
   * Pipeline and Closed rather than at a fixed point in the funnel -- the
   * pursuit is open, we are just not the one moving it. Leaving these in a
   * Pipeline stage was reading as Factur actively working a deal it is not.
   *
   * The reason is the sub-stage rather than a field of its own, which is the
   * shape every other stage here already has: one picklist value carrying the
   * stage and what it is about. It also means a reason filters like any stage
   * and is kept in opportunity_history like any stage change, so which reasons
   * actually convert is answerable later without anything else being built.
   *
   * These are new values -- Salesforce's own picklist has to be given them
   * before Skyvia can sync a pursuit that has been set to one.
   */
  {
    label: "Client-led",
    values: [
      "Client-led: Existing buyer relationship", "Client-led: Engineer to engineer",
      "Client-led: Supplier qualification", "Client-led: Plant tour or site visit",
      "Client-led: NDA / ITAR / confidentiality", "Client-led: Pricing and terms",
      "Client-led: Large quote or capital project", "Client-led: Multi-plant or program",
      "Client-led: Asked to deal direct", "Client-led: Named key target",
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
