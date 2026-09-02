/*
 * See the applied migrations for the full definitions. In summary:
 *
 *   client_attributes         one row per fact about a client, typed by kind
 *   client_attribute_lists    the same gathered back into lists, per client
 *   client_attribute_totals   how many clients hold each value
 *   clients_needing_enrichment  the queue, worst-attempted last
 *
 * The table is rows because that is what makes "everybody who is AS9100" a
 * query rather than a scan. The views exist because a screen showing one client
 * wants the opposite shape, and neither should force the other to change.
 *
 * Both views are security_invoker, so row level security follows through rather
 * than stopping at the view -- which is the mistake the older views in this
 * schema make and which the advisor has been flagging all along.
 */
