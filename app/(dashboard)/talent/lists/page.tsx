import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { listLists } from "@/lib/talent/queries";
import { Chip, Empty, PageHeader, Panel } from "@/components/talent/bits";
import { ago } from "@/lib/talent/format";

export const dynamic = "force-dynamic";

/** Saved sets of records — Loxo's Lists, and its Smart Lists where a filter is saved. */
export default async function ListsPage() {
  await requireTalent("view");
  const lists = (await listLists()) as (Record<string, unknown> & {
    id: string; name: string; description: string | null; entity: string;
    is_smart: boolean; created_at: string;
    tal_list_members: { count: number }[];
    org_members: { full_name: string | null } | null;
  })[];

  return (
    <div className="max-w-3xl space-y-4 p-6">
      <PageHeader title="Lists" count={lists.length} />

      <Panel>
        {lists.length === 0 ? <Empty>No lists</Empty> : (
          <ul className="divide-y text-sm">
            {lists.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/talent/${l.entity === "person" ? "people" : l.entity === "job" ? "jobs" : "companies"}?listId=${l.id}`}
                    className="font-medium hover:underline"
                  >
                    {l.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.description ?? l.entity}
                    {l.org_members?.full_name ? ` · ${l.org_members.full_name}` : ""}
                  </p>
                </div>
                {l.is_smart && <Chip colour="violet">Smart</Chip>}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {l.tal_list_members?.[0]?.count ?? 0}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(l.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
