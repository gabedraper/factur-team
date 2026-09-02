/*
 * The health page shows the ageing itself, not a sentence about it.
 *
 * The receivables card read "$17,600 owed - none past 60 days", a summary of
 * five numbers the collections board already shows in full. Rather than have
 * two screens describe the same money differently, get_client_health now hands
 * over the five buckets and the collections stage, and the card shows what the
 * board shows.
 *
 * The stage follows the same rule as the board: a decision wins, and where
 * nobody has made one the money decides. Null where QuickBooks has no
 * receivables record at all, so the card stays quiet rather than claiming
 * "Current" about a client it knows nothing about.
 *
 * The full function is recorded in the applied migration
 * client_health_carries_ageing_and_stage_v2; it had to be dropped and recreated
 * because the returned columns changed.
 */
