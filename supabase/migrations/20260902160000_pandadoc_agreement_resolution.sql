/*
 * Two more terms the contracts carry, and a way to find the client.
 *
 * Total project fee is not the billing amount and is deliberately not derived
 * into one: dividing it by the term would quietly fold a setup fee into every
 * month for the contracts that bundle it. Both are shown and a person decides.
 *
 * resolve_pandadoc_client answers in order of how much each route can be
 * trusted. The Salesforce opportunity is exact and names one client -- it
 * settled 38 of a 45-document sample on its own. The account is exact but can
 * name several, since a client that has renewed has a client record per run, so
 * it only answers where there is exactly one. The name is a guess and is only
 * reached when both ids are missing.
 *
 * The applied statements are recorded in the migration of the same name.
 */
