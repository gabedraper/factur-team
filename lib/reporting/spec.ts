import { z } from "zod";

/**
 * What a custom report is made of, on both sides of the wire.
 *
 * A report is data: an object name, field names, operator names, values.
 * Nothing here is SQL and nothing here becomes SQL in the app -- the spec is
 * handed to `run_report()` in the database, which checks every name against
 * information_schema before quoting it into a query. The schemas below are
 * the shape check that happens first, so a malformed spec is refused with a
 * message rather than reaching the database at all.
 */

export const KINDS = ["text", "uuid", "number", "date", "datetime", "boolean", "json", "array"] as const;
export type Kind = (typeof KINDS)[number];

/** One table or view, as `report_objects()` describes it. */
export type ObjectMeta = {
  name: string;
  kind: "table" | "view";
  /** Planner estimate, so the builder can warn before a scan of 780k rows. */
  rows: number;
  columns: ColumnMeta[];
};

export type ColumnMeta = {
  name: string;
  kind: Kind;
  /** Set when the column is a foreign key: what it points at, and the column to show. */
  lookup: { table: string; column: string; label: string | null } | null;
};

const ident = z.string().min(1).max(63);

export const FieldRefSchema = z.object({
  field: ident,
  /** A column on the table this field points at, when it is a foreign key. */
  lookup: ident.nullish(),
});
export type FieldRef = z.infer<typeof FieldRefSchema>;

export const FilterSchema = FieldRefSchema.extend({
  op: z.string().min(1).max(30),
  value: z.string().max(500).nullish(),
});
export type Filter = z.infer<typeof FilterSchema>;

export const BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const GroupSchema = FieldRefSchema.extend({
  bucket: z.enum(BUCKETS).nullish(),
});
export type Group = z.infer<typeof GroupSchema>;

export const AGGREGATE_FNS = ["count", "count_distinct", "sum", "avg", "min", "max"] as const;
export type AggregateFn = (typeof AGGREGATE_FNS)[number];

export const AggregateSchema = z.object({
  fn: z.enum(AGGREGATE_FNS),
  field: ident.nullish(),
  lookup: ident.nullish(),
});
export type Aggregate = z.infer<typeof AggregateSchema>;

export const SortSchema = z.object({
  /** An output column key, as the result names it. */
  key: z.string().min(1).max(200),
  dir: z.enum(["asc", "desc"]),
});
export type Sort = z.infer<typeof SortSchema>;

export const SpecSchema = z.object({
  object: ident,
  /** Detail reports: the columns shown. Ignored once there is a group or measure. */
  columns: z.array(FieldRefSchema).max(40).default([]),
  filters: z.array(FilterSchema).max(20).default([]),
  logic: z.enum(["and", "or"]).default("and"),
  groups: z.array(GroupSchema).max(4).default([]),
  aggregates: z.array(AggregateSchema).max(8).default([]),
  sort: z.array(SortSchema).max(3).default([]),
  limit: z.number().int().min(1).max(5000).default(1000),
});
export type Spec = z.infer<typeof SpecSchema>;

export const CHART_TYPES = ["table", "bar", "hbar", "line", "area", "donut", "stat"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const ChartSchema = z.object({
  type: z.enum(CHART_TYPES),
  /** Output key of the group along the axis (or the donut's slices). */
  x: z.string().max(200).nullish(),
  /** Output key of the measure plotted. */
  y: z.string().max(200).nullish(),
  /** Output key of a second group that splits the measure into series. */
  series: z.string().max(200).nullish(),
  stacked: z.boolean().nullish(),
});
export type Chart = z.infer<typeof ChartSchema>;

export const TileSchema = z.object({
  report_id: z.string().uuid(),
  width: z.enum(["third", "half", "full"]),
  title: z.string().max(120).nullish(),
});
export type Tile = z.infer<typeof TileSchema>;

/** One output column, as `run_report()` describes it. */
export type ResultColumn = {
  key: string;
  kind: Kind;
  field: string;
  lookup?: string | null;
  bucket?: string | null;
  fn?: string | null;
};

export type Row = Record<string, unknown>;

export type ReportResult = {
  columns: ResultColumn[];
  rows: Row[];
  /** Rows (or groups) before the limit. */
  total: number;
  limit: number;
  truncated: boolean;
};

export type SavedReport = {
  id: string;
  name: string;
  description: string | null;
  owner_member_id: string;
  shared: boolean;
  spec: Spec;
  chart: Chart | null;
  created_at: string;
  updated_at: string;
};

export type Dashboard = {
  id: string;
  name: string;
  description: string | null;
  owner_member_id: string;
  shared: boolean;
  tiles: Tile[];
  created_at: string;
  updated_at: string;
};

export function emptySpec(object = ""): Spec {
  return { object, columns: [], filters: [], logic: "and", groups: [], aggregates: [], sort: [], limit: 1000 };
}

export function isSummary(spec: Spec): boolean {
  return spec.groups.length > 0 || spec.aggregates.length > 0;
}

// ---------------------------------------------------------------------------
// Operators, per kind. The database has the same list; this one drives the
// filter editor and names the operator in words.
// ---------------------------------------------------------------------------

/** What the value box should hold: nothing, one value, two (a range), a list, or a count of days. */
export type ValueShape = "none" | "one" | "two" | "list" | "days";

export type OperatorDef = { op: string; label: string; value: ValueShape };

const EMPTY: OperatorDef[] = [
  { op: "is_empty", label: "is empty", value: "none" },
  { op: "is_not_empty", label: "is not empty", value: "none" },
];

const TEXT_OPS: OperatorDef[] = [
  { op: "contains", label: "contains", value: "one" },
  { op: "not_contains", label: "does not contain", value: "one" },
  { op: "eq", label: "is", value: "one" },
  { op: "neq", label: "is not", value: "one" },
  { op: "starts_with", label: "starts with", value: "one" },
  { op: "in", label: "is any of", value: "list" },
  { op: "not_in", label: "is none of", value: "list" },
  ...EMPTY,
];

const NUMBER_OPS: OperatorDef[] = [
  { op: "eq", label: "equals", value: "one" },
  { op: "neq", label: "does not equal", value: "one" },
  { op: "gt", label: "greater than", value: "one" },
  { op: "gte", label: "at least", value: "one" },
  { op: "lt", label: "less than", value: "one" },
  { op: "lte", label: "at most", value: "one" },
  { op: "between", label: "between", value: "two" },
  ...EMPTY,
];

const DATE_OPS: OperatorDef[] = [
  { op: "last_n_days", label: "in the last N days", value: "days" },
  { op: "next_n_days", label: "in the next N days", value: "days" },
  { op: "this_week", label: "this week", value: "none" },
  { op: "this_month", label: "this month", value: "none" },
  { op: "last_month", label: "last month", value: "none" },
  { op: "this_quarter", label: "this quarter", value: "none" },
  { op: "this_year", label: "this year", value: "none" },
  { op: "last_year", label: "last year", value: "none" },
  { op: "on", label: "on", value: "one" },
  { op: "before", label: "before", value: "one" },
  { op: "after", label: "after", value: "one" },
  { op: "on_or_before", label: "on or before", value: "one" },
  { op: "on_or_after", label: "on or after", value: "one" },
  { op: "between", label: "between", value: "two" },
  ...EMPTY,
];

const BOOLEAN_OPS: OperatorDef[] = [
  { op: "is_true", label: "is yes", value: "none" },
  { op: "is_false", label: "is no", value: "none" },
  ...EMPTY,
];

const ARRAY_OPS: OperatorDef[] = [
  { op: "contains", label: "includes", value: "one" },
  { op: "not_contains", label: "does not include", value: "one" },
  ...EMPTY,
];

export const OPERATORS: Record<Kind, OperatorDef[]> = {
  text: TEXT_OPS,
  uuid: TEXT_OPS,
  json: TEXT_OPS,
  number: NUMBER_OPS,
  date: DATE_OPS,
  datetime: DATE_OPS,
  boolean: BOOLEAN_OPS,
  array: ARRAY_OPS,
};

export const AGGREGATE_LABELS: Record<AggregateFn, string> = {
  count: "Count of rows",
  count_distinct: "Count of distinct",
  sum: "Sum of",
  avg: "Average of",
  min: "Smallest",
  max: "Largest",
};

export const BUCKET_LABELS: Record<Bucket, string> = {
  day: "by day",
  week: "by week",
  month: "by month",
  quarter: "by quarter",
  year: "by year",
};

export const KIND_LABELS: Record<Kind, string> = {
  text: "text",
  uuid: "id",
  number: "number",
  date: "date",
  datetime: "date & time",
  boolean: "yes/no",
  json: "json",
  array: "list",
};

// ---------------------------------------------------------------------------
// Words for names
// ---------------------------------------------------------------------------

/** "closed_on" -> "Closed on"; "client_id" -> "Client"; "crm_accounts" -> "Crm accounts". */
export function humanize(name: string): string {
  const words = name.replace(/_id$/, "").replace(/[_\s]+/g, " ").trim();
  if (!words) return name;
  return words[0].toUpperCase() + words.slice(1);
}

/** The heading for an output column: "Client › Name", "Sum of amount", "Closed on (month)". */
export function columnLabel(c: ResultColumn): string {
  const base = c.lookup ? `${humanize(c.field)} › ${humanize(c.lookup)}` : humanize(c.field);
  if (c.fn === "count") return "Count";
  if (c.fn) return `${AGGREGATE_LABELS[c.fn as AggregateFn] ?? c.fn} ${base.toLowerCase()}`;
  if (c.bucket) return `${base} (${c.bucket})`;
  return base;
}

/** The key `run_report()` will give a field reference, so the builder can name sorts and axes. */
export function keyFor(ref: FieldRef & { bucket?: string | null }): string {
  const base = ref.lookup ? `${ref.field}__${ref.lookup}` : ref.field;
  return ref.bucket ? `${base}__${ref.bucket}` : base;
}

export function aggregateKey(a: Aggregate): string {
  if (a.fn === "count") return "count";
  return `${a.fn}__${keyFor({ field: a.field ?? "", lookup: a.lookup })}`;
}
