import { sortRows, type SortDir } from "@/lib/sort";
import { firstOf, readParams, SEARCH_KEY, type ReadParams, type SearchParams } from "./params";
import type { AnyReport, Report, Stat } from "./types";

/**
 * Running a report: read the parameters, fetch, narrow, sort, count.
 *
 * A failure is returned, not thrown. The page has to draw "couldn't load"
 * rather than "no rows" -- a broken query showing an empty table is how an
 * app gets reported as broken when it is working, and how a real fault goes
 * unnoticed for a week -- and it can only do that if the failure reaches it
 * as a value.
 */

/**
 * The page stops here. Sorting and the figures above the table still cover
 * every row, so the totals are true; only the drawing is cut short. The CSV
 * has no limit.
 */
export const MAX_ROWS = 1000;

export type Sort = { key: string; dir: SortDir } | null;

export type Outcome<Row> = ReadParams & { sort: Sort } & (
  | { ok: true; rows: Row[]; all: number; stats: Stat[] }
  | { ok: false; error: string }
);

/** org.manage opens everything, as it does on the section layouts. */
export function mayOpen(report: AnyReport, perms: Set<string>): boolean {
  if (report.permissions.length === 0) return true;
  return perms.has("org.manage") || report.permissions.some((p) => perms.has(p));
}

function sortFor<Row>(report: Report<Row>, sp: SearchParams): Sort {
  const key = firstOf(sp, "sort");
  const dir: SortDir = firstOf(sp, "dir") === "desc" ? "desc" : "asc";
  if (key && report.columns.some((c) => c.key === key)) return { key, dir };
  return report.defaultSort ?? null;
}

export async function runReport<Row>(
  report: Report<Row>,
  sp: SearchParams,
  opts: { limit?: number } = {},
): Promise<Outcome<Row>> {
  const read = await readParams(report, sp);
  const sort = sortFor(report, sp);

  try {
    let rows = await report.run(read.values);

    const narrow = report.filter;
    if (narrow) rows = rows.filter((r) => narrow(r, read.values));

    const search = report.search;
    const q = read.values[SEARCH_KEY]?.toLowerCase();
    if (search && q) rows = rows.filter((r) => search(r).toLowerCase().includes(q));

    if (sort) {
      const col = report.columns.find((c) => c.key === sort.key);
      if (col) rows = sortRows(rows, col.read, sort.dir);
    }

    const stats = report.stats?.(rows) ?? [];
    const limit = opts.limit ?? MAX_ROWS;
    return { ...read, sort, ok: true, rows: rows.slice(0, limit), all: rows.length, stats };
  } catch (e) {
    return {
      ...read, sort, ok: false,
      error: e instanceof Error ? e.message : "The report did not run.",
    };
  }
}
