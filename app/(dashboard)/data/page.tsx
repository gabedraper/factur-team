import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { DATA_GROUPS, DATASETS, DATASET_TABLES } from "@/lib/data-catalogue";

export const dynamic = "force-dynamic";

/*
 * What the app holds: every dataset worth browsing, what it is, how much of it
 * there is, and the way in.
 *
 * The counts are the planner's own estimates rather than select count(*). One
 * of these tables is 913,000 rows and nobody reading this page needs the exact
 * figure, but they do need it to load. The heading says "about" so the number
 * is not read as a total anybody should reconcile against.
 */

const count = new Intl.NumberFormat("en-US");

export default async function DataIndexPage() {
  const perms = await myPermissions();
  if (
    !perms.has("timelines.view") &&
    !perms.has("clients.health") &&
    !perms.has("clients.results") &&
    !perms.has("org.manage")
  ) {
    return <NoAccess section="Data" need="View opportunity timelines" />;
  }

  const db = await createClient();
  const { data } = await db.rpc("data_table_estimates", { p_names: DATASET_TABLES });
  const rows = new Map(
    ((data ?? []) as { table_name: string; approx_rows: number }[]).map((r) => [
      r.table_name,
      r.approx_rows,
    ]),
  );

  return (
    <div className="space-y-4 p-section">
      <PageHeader title="Data" />

      <p className="text-meta text-muted-foreground">
        Row counts are approximate.
      </p>

      {DATA_GROUPS.map((group) => {
        const sets = DATASETS.filter((d) => d.group === group);
        if (sets.length === 0) return null;
        return (
          <section key={group} className="space-y-2">
            <h2 className="text-section-title">{group}</h2>
            <Surface pad="none">
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Dataset</TH>
                      <TH>What it holds</TH>
                      <TH>Table</TH>
                      <TH numeric>Rows</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {sets.map((d) => (
                      <TR key={d.table} interactive>
                        <TD>
                          {d.href ? (
                            <Link href={d.href} className="hover:underline underline-offset-2">
                              {d.label}
                            </Link>
                          ) : (
                            d.label
                          )}
                        </TD>
                        <TD className="text-muted-foreground">{d.description}</TD>
                        <TD className="text-muted-foreground">{d.table}</TD>
                        <TD numeric className="text-muted-foreground">
                          {rows.has(d.table) ? count.format(rows.get(d.table)!) : ""}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            </Surface>
          </section>
        );
      })}
    </div>
  );
}
