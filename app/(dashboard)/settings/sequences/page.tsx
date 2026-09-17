import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { createServiceClient } from "@/lib/supabase/server";
import { NewSequence } from "@/components/sequences/NewSequence";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";

export const dynamic = "force-dynamic";

type Row = {
  slug: string; name: string; description: string | null;
  mode: "semi" | "full"; active: boolean; steps: { count: number }[];
};

export default async function SequencesPage() {
  const perms = await myPermissions();
  const may =
    perms.has("org.manage") || perms.has("finance.collections") || perms.has("nps.send");
  if (!may) redirect("/settings");

  /*
   * Archived ones are listed too, at the bottom and marked. They used to be
   * filtered out here, which made archiving a one-way door: the only button
   * that brings one back lives on its own page, and the only way to that page
   * is this list.
   */
  const { data } = await createServiceClient()
    .from("sequences")
    .select("slug,name,description,mode,active,steps:sequence_steps(count)")
    .order("name");

  const all = (data ?? []) as unknown as Row[];
  const rows = all.filter((s) => s.active);
  const archived = all.filter((s) => !s.active);

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <PageHeader
        title="Sequences"
        actions={<>{perms.has("org.manage") && <div className="ml-auto"><NewSequence /></div>}</>}
      />

      <Surface pad="none" className="overflow-hidden">
        {rows.map((s) => (
          <Link
            key={s.slug}
            href={`/settings/sequences/${s.slug}`}
            className="flex items-center gap-3 border-b p-3 last:border-0 hover:bg-muted/40"
          >
            <div className="min-w-0">
              <div className="font-medium">{s.name}</div>
              <div className="truncate text-body text-muted-foreground">{s.description}</div>
            </div>
            <div className="ml-auto shrink-0 text-body text-muted-foreground">
              {s.steps?.[0]?.count ?? 0} steps ·{" "}
              {s.mode === "full" ? "sends" : "drafts"}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </Surface>

      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-meta uppercase tracking-wide text-muted-foreground">Archived</h2>
          <Surface pad="none" className="overflow-hidden">
            {archived.map((s) => (
              <Link
                key={s.slug}
                href={`/settings/sequences/${s.slug}`}
                className="flex items-center gap-3 border-b p-3 last:border-0 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="font-medium text-muted-foreground">{s.name}</div>
                  <div className="truncate text-body text-muted-foreground">{s.description}</div>
                </div>
                <div className="ml-auto shrink-0 text-body text-muted-foreground">
                  {s.steps?.[0]?.count ?? 0} steps
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </Surface>
        </section>
      )}
    </div>
  );
}
