/**
 * Comparison rules for click-to-sort tables. Pure and free of React, so the
 * behaviour below can be exercised on its own.
 */
export type SortDir = "asc" | "desc";
export type SortValue = string | number | boolean | null | undefined;

/** A blank cell means "not filled in", which is not the same as "smallest". */
export function isBlank(v: SortValue): boolean {
  return v === null || v === undefined || v === "";
}

export function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  // numeric:true so "Phase 10" lands after "Phase 9"; sensitivity:"base" so
  // case and accents do not split names that read as the same word.
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Sort a copy of `rows` by one column.
 *
 * Blanks always sit at the bottom, whichever direction is chosen -- flipping
 * the sort to bring empty cells to the top is never what someone wanted. Rows
 * that tie keep the order they arrived in, so re-sorting does not shuffle them.
 */
export function sortRows<T>(
  rows: T[],
  read: (row: T) => SortValue,
  dir: SortDir
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, value: read(row) }))
    .sort((a, b) => {
      const aBlank = isBlank(a.value), bBlank = isBlank(b.value);
      // One blank sinks. Two blanks are equally absent -- comparing them would
      // order a null against an empty string on the text "null".
      if (aBlank || bBlank) return aBlank && bBlank ? a.i - b.i : aBlank ? 1 : -1;
      return compare(a.value, b.value) * sign || a.i - b.i;
    })
    .map((d) => d.row);
}

/** Clicking a header cycles ascending -> descending -> back to the given order. */
export function nextSort<K extends string>(
  current: { key: K; dir: SortDir } | null,
  key: K
): { key: K; dir: SortDir } | null {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}
