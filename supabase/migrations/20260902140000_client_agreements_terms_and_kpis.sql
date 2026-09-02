/*
 * What we agreed with a client, and whether we are doing it.
 *
 * Three tables, kept apart on purpose. client_agreements is the signed document
 * -- evidence, never edited in place. client_terms is a reading of it, one row
 * per client, every field nullable because a contract silent on a setup fee
 * should leave it empty rather than claim nought to somebody deciding what to
 * invoice. client_kpi_targets is what we promised, per month, because that is
 * how the results are already counted.
 *
 * get_client_agreement puts the three together and sets each KPI beside what
 * actually happened, averaged over the months a client has really been running
 * rather than months on the calendar.
 *
 * project_completion is listed but has no source yet -- it comes from ClickUp,
 * which is a later job.
 *
 * The full statements are recorded in the applied migration
 * client_agreements_terms_and_kpi_targets.
 */
