import type { Permission } from "@/lib/org";
import type { SortDir, SortValue } from "@/lib/sort";

/**
 * What a report is made of.
 *
 * A report is a definition, not a page: a name, the parameters it accepts,
 * the columns it shows and a function that fetches its rows. One generic page
 * renders every definition, so adding a report means adding one file under
 * `defs/` and one line in the catalogue -- never a new page, table or filter
 * bar. That is the whole point of having an engine rather than a folder of
 * one-off screens, of which the app already had several.
 *
 * Nothing here is executed from data. Parameters are typed and validated
 * before `run` sees them, columns read rows through functions rather than
 * field names, and the query itself lives in code. A report can therefore be
 * pointed at any existing data module -- `getClientHealth`, a Supabase view, an
 * RPC -- without that module knowing it is being reported on.
 */

/**
 * How a cell is drawn and sorted.
 *
 * `identity` is the company cell -- logo, name, optional second line -- and it
 * is only for companies. People lists do not carry a thumbnail (see the design
 * rules: a favicon is a real signal, an avatar is nearly always initials), so a
 * person's name is a plain `text` column.
 */
export type CellType = "text" | "number" | "money" | "percent" | "date" | "identity";

export type Column<Row> = {
  key: string;
  label: string;
  type: CellType;
  /** The value to show and to sort on. Return null for "not filled in". */
  read: (row: Row) => SortValue;
  /** identity only: the web or email domain the logo is fetched for. */
  domain?: (row: Row) => string | null | undefined;
  /** identity only: the second line under the name. */
  sub?: (row: Row) => string | null | undefined;
  /** Where clicking the cell goes -- the record, usually. */
  href?: (row: Row) => string | null | undefined;
  /** Adds a footer row. `sum` for counts and money, `avg` for rates. */
  total?: "sum" | "avg";
  /** Secondary information, drawn in the muted colour. */
  muted?: boolean;
};

export type Option = { value: string; label: string };

/**
 * A parameter is read from the URL, so a filtered report survives a reload,
 * works with the back button and can be pasted to a colleague. Each kind
 * validates what arrives: a date that is not a date and a picklist value that
 * is not an option are dropped rather than passed through.
 */
export type Param =
  | { key: string; label: string; type: "date"; default?: () => string }
  | { key: string; label: string; type: "text"; placeholder?: string }
  | {
      key: string;
      label: string;
      type: "picklist";
      /** Static, or fetched -- a list of clients, say. */
      options: Option[] | (() => Promise<Option[]>);
      /** With a default there is no "Any" choice; the report always has a value. */
      default?: string;
      /** What the blank choice is called. "Any" unless told otherwise. */
      any?: string;
    };

export type Values = Record<string, string>;

export type Stat = { label: string; value: string };

/** The headings on the index page, in the order they appear. */
export const GROUPS = ["Clients", "Finance", "Sales", "Talent", "Training"] as const;
export type Group = (typeof GROUPS)[number];

export type Report<Row> = {
  /** The URL segment: /reports/<key>. */
  key: string;
  label: string;
  /** One line saying what question the report answers. */
  description: string;
  group: Group;
  /** Plural, lower case, for the empty states: "clients", "responses". */
  noun: string;
  /**
   * Any one of these opens it, as does org.manage. Empty means anyone signed
   * in -- the training report is company-wide, like the scoreboards.
   *
   * Reports reuse the grants that already gate the screens they draw from,
   * so the people who can see Client Health are exactly the people who can
   * see the client health report. No second list of rights to keep in step.
   */
  permissions: Permission[];
  params: Param[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  defaultSort?: { key: string; dir: SortDir };
  /**
   * Text to match a search box against. Setting it adds the box; the match is
   * a case-insensitive substring over whatever is returned.
   */
  search?: (row: Row) => string;
  /** Fetches the rows. Receives the validated parameter values. */
  run: (values: Values) => Promise<Row[]>;
  /**
   * Narrows the fetched rows by the parameter values, for reports whose
   * source returns the whole set. Reports whose source takes the parameters
   * itself (a date-ranged RPC) leave this out.
   */
  filter?: (row: Row, values: Values) => boolean;
  /** The figures above the table, over the filtered rows. */
  stats?: (rows: Row[]) => Stat[];
};

/* Definitions of different row shapes have to sit in one list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyReport = Report<any>;
