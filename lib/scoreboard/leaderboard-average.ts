/**
 * Given a list already sorted descending by `getValue`, finds the index of
 * the first item that falls below the group's average -- i.e. where a
 * "Company Average" divider should be inserted to split above/below.
 * Returns `items.length` if every item is at or above average (divider goes
 * at the bottom), or null if there's nothing to average.
 */
export function companyAverageSplit<T>(
  items: T[],
  getValue: (item: T) => number
): { average: number; insertAt: number } | null {
  if (items.length === 0) return null;
  const average = items.reduce((sum, item) => sum + getValue(item), 0) / items.length;
  const insertAt = items.findIndex((item) => getValue(item) < average);
  return { average, insertAt: insertAt === -1 ? items.length : insertAt };
}
