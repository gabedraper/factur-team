/**
 * Reading more than a thousand rows from Supabase.
 *
 * The API returns at most 1,000 rows per request, and says nothing when it
 * stops: .limit(20000) and .range(0, 4999) both come back with exactly 1,000.
 * Measured 2026-09-11. A query that can outgrow that has to page, and the only
 * sign that it needed to is a page shorter than the one before.
 *
 * Plain .mjs, with every-row.d.mts beside it for types, so the app and the
 * Node scripts share one implementation rather than three copies of a loop.
 *
 * `build` makes a fresh query each time, because a PostgREST builder can only
 * be awaited once. Give it a stable .order() or rows can repeat or vanish
 * between pages.
 */
export const PAGE = 1000;

export async function everyRow(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Run a query once per slice of a long id list. An .in() with thousands of ids
 * both hits the row cap and outgrows a URL, so it is sliced well under either.
 */
export async function inSlices(ids, run, size = 300) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await run(ids.slice(i, i + size))));
  return out;
}
