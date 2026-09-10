import { formatDay } from "./format";
import type { AnyReport, Option, Param, Values } from "./types";

/**
 * Reading a report's parameters out of the URL.
 *
 * Filters live in the URL rather than in component state -- the same rule as
 * every list page -- so the values here are exactly what the address bar
 * says, validated against the definition. Anything the definition does not
 * name, or names but cannot accept, is dropped.
 */

/** Next's searchParams shape. */
export type SearchParams = Record<string, string | string[] | undefined>;

export const SEARCH_KEY = "q";

export function firstOf(sp: SearchParams, key: string): string {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? "").trim();
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function optionsOf(param: Param): Promise<Option[]> {
  if (param.type !== "picklist") return [];
  return typeof param.options === "function" ? param.options() : param.options;
}

export type ReadParams = {
  values: Values;
  /**
   * The filters in force, in the words on screen -- "Status: Active". Used by
   * the empty state to say what excluded everything. A default is not a
   * filter somebody applied, so it is not listed.
   */
  active: string[];
  /** Resolved picklist options, so the form does not fetch them twice. */
  options: Record<string, Option[]>;
};

export async function readParams(report: AnyReport, sp: SearchParams): Promise<ReadParams> {
  const values: Values = {};
  const active: string[] = [];
  const options: Record<string, Option[]> = {};

  for (const p of report.params) {
    const raw = firstOf(sp, p.key);

    if (p.type === "date") {
      const fallback = p.default?.() ?? "";
      const v = ISO_DAY.test(raw) ? raw : fallback;
      if (v) values[p.key] = v;
      if (v && v !== fallback) active.push(`${p.label}: ${formatDay(v)}`);
      continue;
    }

    if (p.type === "picklist") {
      const opts = await optionsOf(p);
      options[p.key] = opts;
      // A default that is not among the options -- a choice this person is
      // not offered -- falls back to the first option they are.
      const fallback = p.default
        ? (opts.some((o) => o.value === p.default) ? p.default : opts[0]?.value ?? "")
        : "";
      const v = opts.some((o) => o.value === raw) ? raw : fallback;
      if (v) values[p.key] = v;
      if (v && v !== fallback) {
        active.push(`${p.label}: ${opts.find((o) => o.value === v)?.label ?? v}`);
      }
      continue;
    }

    // Free text. Capped so a pasted document cannot become a query.
    const v = raw.slice(0, 200);
    if (v) {
      values[p.key] = v;
      active.push(`${p.label}: ${v}`);
    }
  }

  if (report.search) {
    const q = firstOf(sp, SEARCH_KEY).slice(0, 200);
    if (q) {
      values[SEARCH_KEY] = q;
      active.push(`Search: ${q}`);
    }
  }

  return { values, active, options };
}

/** The report's address with these values, plus any changes. Blanks are left out. */
export function reportHref(key: string, values: Values, patch: Values = {}): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...values, ...patch })) {
    if (v) next.set(k, v);
  }
  const qs = next.toString();
  return `/reports/standard/${key}${qs ? `?${qs}` : ""}`;
}

export function clearHref(key: string): string {
  return `/reports/standard/${key}`;
}
