import type { SortValue } from "@/lib/sort";
import type { CellType } from "./types";

/**
 * How a cell reads. One place, so a dollar figure or a percentage is written
 * the same way on every report -- and so the CSV can ask for the raw value
 * instead, which is what a spreadsheet wants.
 */

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** A YYYY-MM-DD from the database, shown without the timezone shifting it. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatCell(type: CellType, value: SortValue): string {
  // A blank is "not filled in", which is different from zero and is shown as
  // a dash rather than as a number that was never measured.
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  switch (type) {
    case "number":
      return typeof value === "number" ? nf.format(value) : String(value);
    case "money":
      return typeof value === "number" ? money.format(value) : String(value);
    case "percent":
      return typeof value === "number" ? `${Math.round(value)}%` : String(value);
    case "date":
      return formatDay(String(value));
    default:
      return String(value);
  }
}

/** The value as a spreadsheet wants it: unformatted, so it can be added up. */
export function rawCell(type: CellType, value: SortValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (type === "percent" && typeof value === "number") return String(Math.round(value * 10) / 10);
  return String(value);
}
