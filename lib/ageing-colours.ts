/**
 * One colour per ageing bucket, warming as the debt gets older.
 *
 * Shared rather than written twice: the board and the client screen show the
 * same five buckets, and a client whose 61-90 reads red on one page and amber
 * on the other is a client nobody trusts either page about.
 *
 * The dark values are not the light ones dimmed. On a dark card a colour has to
 * get *brighter* to read as more urgent, so 91-and-over is the lightest red of
 * the set there and the darkest in daylight.
 */
export const AGEING_TONE = {
  current: "text-muted-foreground",
  b1_30: "text-yellow-600 dark:text-yellow-300",
  b31_60: "text-orange-600 dark:text-orange-400",
  b61_90: "text-red-700 dark:text-red-500",
  b91_plus: "font-semibold text-red-500 dark:text-red-300",
} as const;
