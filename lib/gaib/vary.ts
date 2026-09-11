/*
 * Say it differently each time.
 *
 * Gaib's fixed messages -- the ones sent without the model, like "give me a
 * minute on that one" -- were one string each, word for word identical every
 * time. People notice that fast, and once they do the whole thing reads as a
 * script. A person does not say the same sentence twice in a row.
 *
 * So each is a handful of lines in Gabe's voice and this picks one, never the
 * same one twice running within an instance. Across serverless instances the
 * memory resets, so an occasional repeat still happens -- a person also
 * repeats themselves now and then, just not every time.
 */

const lastPick = new Map<string, number>();

export function vary(key: string, lines: readonly string[]): string {
  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0];
  const previous = lastPick.get(key);
  let i = Math.floor(Math.random() * lines.length);
  if (i === previous) i = (i + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length;
  lastPick.set(key, i);
  return lines[i];
}

/**
 * Dashes out.
 *
 * Gabe never uses an em dash, and a clone that does is a tell. The voice guide
 * says so and the model mostly listens; this catches what it does not. A
 * spaced dash becomes a comma, which is what he would have typed.
 */
export function noDashes(text: string): string {
  return text
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ", ")
    .replace(/,\s*,/g, ",");
}
