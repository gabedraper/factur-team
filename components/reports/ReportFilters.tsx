import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { clearHref, SEARCH_KEY } from "@/lib/reports/params";
import type { Sort } from "@/lib/reports/run";
import type { AnyReport, Option, Values } from "@/lib/reports/types";
import { Field } from "@/components/ui/field";
import { control } from "@/components/ui/control";

/**
 * The filter bar, drawn from the report's parameter list.
 *
 * A plain GET form. Submitting it changes the URL, which is where the filters
 * live -- so it works without JavaScript, the back button undoes it, and the
 * address is the thing to paste to a colleague. Label above every field, and
 * a picklist is a native select for the same reason: it posts.
 */

/* Every control on the filter bar, from the app's one recipe. */
const FIELD = control({ size: "sm", className: "flex w-full" });

export function ReportFilters({
  report,
  values,
  options,
  active,
  sort,
}: {
  report: AnyReport;
  values: Values;
  options: Record<string, Option[]>;
  active: string[];
  sort: Sort;
}) {
  if (report.params.length === 0 && !report.search) return null;

  return (
    <Surface pad="tight">
      <form
        method="get"
        action={`/reports/${report.key}`}
        className="flex flex-wrap items-end gap-3"
      >
        {/* Re-filtering should not lose the column somebody sorted by. */}
        {sort ? (
          <>
            <input type="hidden" name="sort" value={sort.key} />
            <input type="hidden" name="dir" value={sort.dir} />
          </>
        ) : null}

        {report.params.map((p) => (
          <Field label={<>{p.label}</>}>
            {p.type === "picklist" ? (
              <select name={p.key} defaultValue={values[p.key] ?? ""} className={FIELD}>
                {p.default ? null : <option value="">{p.any ?? "Any"}</option>}
                {(options[p.key] ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <Input
                name={p.key}
                type={p.type === "date" ? "date" : "text"}
                defaultValue={values[p.key] ?? ""}
                placeholder={p.type === "text" ? p.placeholder : undefined}
                className="h-9"
              />
            )}
          </Field>
        ))}

        {report.search ? (
          <Field label="Search">
            <Input
              name={SEARCH_KEY}
              type="search"
              defaultValue={values[SEARCH_KEY] ?? ""}
              placeholder="Name or keyword"
              className="h-9"
            />
          </Field>
        ) : null}

        <div className="flex h-9 items-center gap-3">
          <Button type="submit" size="sm">Apply filters</Button>
          {active.length > 0 ? (
            <Link
              href={clearHref(report.key)}
              className="text-body text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>
    </Surface>
  );
}
