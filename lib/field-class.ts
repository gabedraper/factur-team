/**
 * The tint every editable field on a sequence builder wears, so the parts you
 * can type into stand out against the cards they sit on.
 *
 * Shared rather than copied. It started as a local constant in the collections
 * builder; the NPS one was built separately and ended up looking nothing like
 * it, which is the whole reason this file exists. One definition means the two
 * screens cannot drift apart again.
 */
export const FIELD =
  "rounded-md border border-sky-200 bg-sky-50 text-foreground " +
  "placeholder:text-sky-900/40 focus:outline-none focus:ring-2 focus:ring-sky-400 " +
  "dark:border-sky-900 dark:bg-sky-950/40 dark:placeholder:text-sky-100/30";
