import { ArrowDown, ArrowUp } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatValue } from "@/lib/reporting/format";
import { columnLabel, type ReportResult, type Sort } from "@/lib/reporting/spec";
import { cn } from "@/lib/utils";

/**
 * A report's rows. Figures right-aligned with tabular numerals; headers are
 * buttons when the caller can re-sort, plain text otherwise. Server or
 * client -- it holds no state of its own.
 */
export function ResultTable({
  result,
  sort,
  onSort,
  maxRows,
}: {
  result: ReportResult;
  sort?: Sort | null;
  /** When given, headers sort. The caller re-runs the report. */
  onSort?: (key: string) => void;
  maxRows?: number;
}) {
  const rows = maxRows ? result.rows.slice(0, maxRows) : result.rows;
  return (
    <Surface pad="none">
      <TableScroll>
        <Table>
          <THead>
            <TR>
              {result.columns.map((c) => {
                const numeric = c.kind === "number";
                const current = sort?.key === c.key ? sort.dir : null;
                const label = (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    {columnLabel(c)}
                    {current === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : null}
                    {current === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden /> : null}
                  </span>
                );
                return (
                  <TH
                    key={c.key}
                    numeric={numeric}
                    aria-sort={current ? (current === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className="transition-colors duration-fast ease-out hover:text-foreground"
                      >
                        {label}
                      </button>
                    ) : label}
                  </TH>
                );
              })}
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                {result.columns.map((c) => (
                  <TD
                    key={c.key}
                    numeric={c.kind === "number"}
                    className={cn("max-w-[24rem] truncate", c.kind === "uuid" && "text-meta text-muted-foreground")}
                    title={c.kind === "text" ? formatValue(c.kind, r[c.key]) : undefined}
                  >
                    {formatValue(c.kind, r[c.key])}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
    </Surface>
  );
}
