import { rawCell } from "./format";
import type { Report } from "./types";

/**
 * The report as a file.
 *
 * Every column, every row, the raw values: this is what somebody opens in a
 * spreadsheet to do the thing the page does not do. The page shows formatted
 * figures and stops at a thousand rows; the file does neither.
 */
export function toCsv<Row>(report: Report<Row>, rows: Row[]): string {
  const cell = (s: string) => {
    let v = s;
    /*
     * A cell beginning with = + @ (or a - that is not a number) is run as a
     * formula by Excel and Sheets. A client called "=HYPERLINK(...)" is
     * unlikely, but a report is exactly where untrusted text -- an NPS
     * comment, a Salesforce note -- ends up in a spreadsheet.
     */
    if (/^[=+@]/.test(v) || (/^-/.test(v) && Number.isNaN(Number(v)))) v = `'${v}`;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };

  const header = report.columns.map((c) => cell(c.label)).join(",");
  const lines = rows.map((r) =>
    report.columns.map((c) => cell(rawCell(c.type, c.read(r)))).join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
