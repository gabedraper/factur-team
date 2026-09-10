import type { Kind, Row } from "./spec";

/**
 * How a result cell reads. Numbers get separators and at most one decimal,
 * money is not assumed -- a report does not know which numbers are dollars
 * -- and dates come out without the timezone moving them.
 */

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatValue(kind: Kind, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (kind) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? nf.format(n) : String(value);
    }
    case "boolean":
      return value ? "Yes" : "No";
    case "date":
      return formatDay(String(value));
    case "datetime": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime())
        ? String(value)
        : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    }
    case "array":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    default:
      return String(value);
  }
}

/** A large standalone figure: 1,284 / 12.9K / 4.2M. */
export function formatCompact(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) < 10000 ? nf.format(n) : compact.format(n);
}

/** Postgres numerics arrive as strings; a chart needs numbers. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The value as a spreadsheet wants it. */
export function rawValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function toCsv(columns: { key: string; label: string }[], rows: Row[]): string {
  const cell = (s: string) => {
    let v = s;
    if (/^[=+@]/.test(v) || (/^-/.test(v) && Number.isNaN(Number(v)))) v = `'${v}`;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const header = columns.map((c) => cell(c.label)).join(",");
  const lines = rows.map((r) => columns.map((c) => cell(rawValue(r[c.key]))).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
