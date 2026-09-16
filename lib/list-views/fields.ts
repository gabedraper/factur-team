/*
 * The parts of a saved view that do not care which records it lists.
 *
 * A view stores field keys and operator names, never SQL, so everything a
 * saved view can point at has to be declared in a catalogue somewhere. This
 * file holds the half of that idea which is the same for every entity -- the
 * field types, the operators each type accepts, and what an operator means --
 * and leaves each entity to declare its own fields.
 *
 * It was opportunities-only until clients needed the same thing. The types
 * moved here rather than being copied because the copy is how two lists end up
 * disagreeing about whether "contains" is offered on a dropdown, and the answer
 * to that one is load-bearing: ilike '%...%' cannot seek an index, and a
 * picklist offered "contains" took one real view from 7.9ms to a timeout.
 *
 * Nothing here reaches the database or the browser, so both sides can import
 * it: the editor reads it to offer operators, the reader reads it to apply
 * them.
 */

export type FieldType = "text" | "number" | "date" | "picklist" | "boolean";

/** What every entity's field declaration has in common. */
export type BaseField = {
  key: string;
  label: string;
  type: FieldType;
  /** Names a set of allowed values the editor should offer instead of a box. */
  picklist?: string;
};

export type Operator =
  | "contains" | "not_contains" | "equals" | "not_equals"
  | "starts_with" | "not_starts_with"
  | "on" | "before" | "after" | "on_or_before" | "on_or_after"
  | "greater_than" | "less_than"
  | "is_true" | "is_false"
  | "is_empty" | "is_not_empty";

export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: "contains",
  not_contains: "does not contain",
  equals: "equals",
  not_equals: "does not equal",
  starts_with: "starts with",
  not_starts_with: "does not start with",
  on: "on",
  before: "before",
  after: "after",
  on_or_before: "on or before",
  on_or_after: "on or after",
  greater_than: "more than",
  less_than: "less than",
  is_true: "is checked",
  is_false: "is not checked",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const TEXT_OPS: Operator[] = [
  "contains", "not_contains", "equals", "not_equals",
  "starts_with", "not_starts_with", "is_empty", "is_not_empty",
];
const DATE_OPS: Operator[] = ["on", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"];
const NUMBER_OPS: Operator[] = ["equals", "not_equals", "greater_than", "less_than", "is_empty", "is_not_empty"];
const BOOL_OPS: Operator[] = ["is_true", "is_false"];

/*
 * No "contains" on a picklist, and that is a performance decision as much as a
 * semantic one. A picklist is a closed set of exact strings chosen from a
 * dropdown, so contains was never the right question -- and on the entities
 * that filter in the database, ilike '%...%' cannot seek an index.
 */
const PICKLIST_OPS: Operator[] = ["equals", "not_equals", "is_empty", "is_not_empty"];

export function operatorsFor(type: FieldType): Operator[] {
  if (type === "date") return DATE_OPS;
  if (type === "number") return NUMBER_OPS;
  if (type === "boolean") return BOOL_OPS;
  if (type === "picklist") return PICKLIST_OPS;
  return TEXT_OPS;
}

/** Operators that ignore whatever is in the value box. */
export function opTakesNoValue(op: Operator): boolean {
  return op === "is_empty" || op === "is_not_empty" || op === "is_true" || op === "is_false";
}

export type Filter = { field: string; op: Operator; value?: string | null };

export type ListView = {
  id: string;
  name: string;
  owner_member_id: string | null;
  shared: boolean;
  columns: string[];
  filters: Filter[];
  sort_field: string | null;
  sort_dir: "asc" | "desc";
};

/*
 * Dates accept "today" as a value, because a view saved with a fixed date stops
 * being useful the next morning. Anything else is expected to be an ISO date
 * and is handed through as written -- a malformed one filters nothing rather
 * than erroring, which is the gentler failure on a saved view.
 */
export function resolveDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "today") return new Date().toISOString().slice(0, 10);
  if (v === "tomorrow" || v === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() + (v === "tomorrow" ? 1 : -1));
    return d.toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

/** Only keys the catalogue knows, so a stale saved view degrades instead of breaking. */
export function columnsKnownTo<F extends BaseField>(byKey: Map<string, F>, columns: string[]): F[] {
  return (columns ?? []).map((k) => byKey.get(k)).filter((f): f is F => Boolean(f));
}

export function filtersKnownTo<F extends BaseField>(byKey: Map<string, F>, filters: Filter[]): Filter[] {
  return (filters ?? []).filter((f) => {
    const field = byKey.get(f?.field);
    return Boolean(field) && operatorsFor(field!.type).includes(f.op);
  });
}

/*
 * Applying a filter to a value already in memory.
 *
 * The entities that can push a filter into Postgres should: the database is
 * better at it and a million opportunities will never fit in a request. This is
 * for the ones that cannot -- org_clients is rebuilt by Coupler on every sync,
 * so it carries no foreign keys for PostgREST to follow, and a client's account
 * manager, team lead and service all come from separate reads stitched together
 * in JavaScript. Nine hundred rows is small enough that this is honest rather
 * than lazy.
 *
 * A filter that cannot be evaluated matches everything, matching the rule
 * elsewhere that a saved view degrades rather than empties.
 */
export function matches(value: unknown, filter: Filter, type: FieldType): boolean {
  const empty = value === null || value === undefined || value === "";
  if (filter.op === "is_empty") return empty;
  if (filter.op === "is_not_empty") return !empty;
  if (filter.op === "is_true") return value === true;
  if (filter.op === "is_false") return value === false || empty;

  const raw = (filter.value ?? "").trim();
  if (!raw) return true;

  if (type === "date") {
    const want = resolveDate(raw);
    if (!want || empty) return false;
    const got = String(value).slice(0, 10);
    if (filter.op === "on") return got === want;
    if (filter.op === "before") return got < want;
    if (filter.op === "after") return got > want;
    if (filter.op === "on_or_before") return got <= want;
    if (filter.op === "on_or_after") return got >= want;
    return true;
  }

  if (type === "number") {
    const want = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(want) || empty) return false;
    const got = Number(value);
    if (!Number.isFinite(got)) return false;
    if (filter.op === "equals") return got === want;
    if (filter.op === "not_equals") return got !== want;
    if (filter.op === "greater_than") return got > want;
    if (filter.op === "less_than") return got < want;
    return true;
  }

  const got = empty ? "" : String(value).toLowerCase();
  const want = raw.toLowerCase();
  if (filter.op === "equals") return got === want;
  if (filter.op === "not_equals") return got !== want;
  if (filter.op === "contains") return got.includes(want);
  if (filter.op === "not_contains") return !got.includes(want);
  if (filter.op === "starts_with") return got.startsWith(want);
  if (filter.op === "not_starts_with") return !got.startsWith(want);
  return true;
}
