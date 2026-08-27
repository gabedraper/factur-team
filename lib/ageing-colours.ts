/**
 * One colour per ageing bucket, warming as the debt gets older.
 *
 * Shared rather than written twice: the board and the client screen show the
 * same five buckets, and a client whose 61-90 reads red on one page and amber
 * on the other is a client nobody trusts either page about.
 *
 * The oldest bucket is the most saturated red, not the palest. Lightening it on
 * a dark background was the theory; in practice a pale red reads as washed out
 * and the 61-90 column shouted louder than the 91-and-over one beside it.
 */
export const AGEING_TONE = {
  current: "text-muted-foreground",
  b1_30: "text-yellow-600 dark:text-yellow-300",
  b31_60: "text-orange-600 dark:text-orange-400",
  b61_90: "text-red-500 dark:text-red-300",
  b91_plus: "font-semibold text-red-700 dark:text-red-500",
} as const;
