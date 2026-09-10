import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD, TDIdentity } from "@/components/ui/table";
import { CompanyLogo } from "@/components/ui/thumbnail";
import { formatCell } from "@/lib/reports/format";
import { reportHref } from "@/lib/reports/params";
import type { Sort } from "@/lib/reports/run";
import type { Column, Report, Values } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

/**
 * The table, drawn from the report's column list.
 *
 * Headers are links. Sorting is a URL change like everything else on the
 * page, so a sorted report can be reloaded, shared and undone with the back
 * button. Figures are right-aligned with tabular numerals through
 * `<TD numeric>`, and money and counts get a footer when the definition asks
 * for one.
 */

const NUMERIC = new Set(["number", "money", "percent"]);

export function ReportTable<Row>({
  report,
  rows,
  values,
  sort,
}: {
  report: Report<Row>;
  rows: Row[];
  values: Values;
  sort: Sort;
}) {
  /* Ascending first, then descending. A third click on a column of figures is
     rare enough that it simply flips again rather than clearing. */
  const sortHref = (c: Column<Row>) => {
    const dir = sort?.key === c.key && sort.dir === "asc" ? "desc" : "asc";
    return reportHref(report.key, values, { sort: c.key, dir });
  };

  const hasTotals = report.columns.some((c) => c.total);

  return (
    <Surface pad="none">
      <TableScroll>
        <Table>
          <THead>
            <TR>
              {report.columns.map((c) => {
                const current = sort?.key === c.key ? sort.dir : null;
                return (
                  <TH
                    key={c.key}
                    numeric={NUMERIC.has(c.type)}
                    aria-sort={current ? (current === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <Link
                      href={sortHref(c)}
                      className="inline-flex items-center gap-1 whitespace-nowrap transition-colors duration-fast ease-out hover:text-foreground"
                    >
                      {c.label}
                      {current === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : null}
                      {current === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden /> : null}
                    </Link>
                  </TH>
                );
              })}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={report.rowKey(r)}>
                {report.columns.map((c) => (
                  <Cell key={c.key} col={c} row={r} />
                ))}
              </TR>
            ))}
          </TBody>
          {hasTotals ? (
            <tfoot>
              <TR className="border-t font-medium">
                {report.columns.map((c, i) => (
                  <TD key={c.key} numeric={NUMERIC.has(c.type)}>
                    {c.total
                      ? formatCell(c.type, totalOf(c, rows))
                      : i === 0
                        ? "Total"
                        : ""}
                  </TD>
                ))}
              </TR>
            </tfoot>
          ) : null}
        </Table>
      </TableScroll>
    </Surface>
  );
}

/* Over the rows drawn, which is every row unless the page has been cut short
   at MAX_ROWS -- and the page says so when it has. */
function totalOf<Row>(col: Column<Row>, rows: Row[]): number | null {
  const nums = rows.map(col.read).filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return col.total === "avg" ? sum / nums.length : sum;
}

function Cell<Row>({ col, row }: { col: Column<Row>; row: Row }) {
  const value = col.read(row);
  const href = col.href?.(row);

  if (col.type === "identity") {
    const name = value === null || value === undefined ? "—" : String(value);
    return (
      <TDIdentity
        thumb={<CompanyLogo name={name} domain={col.domain?.(row)} size={24} />}
        name={href ? <Link href={href} className="hover:underline">{name}</Link> : name}
        sub={col.sub?.(row) ?? undefined}
      />
    );
  }

  const text = formatCell(col.type, value);
  return (
    <TD numeric={NUMERIC.has(col.type)} className={cn(col.muted && "text-muted-foreground")}>
      {href ? <Link href={href} className="hover:underline">{text}</Link> : text}
    </TD>
  );
}
