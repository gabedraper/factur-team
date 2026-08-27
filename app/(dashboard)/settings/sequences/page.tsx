import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { createServiceClient } from "@/lib/supabase/server";
import { NewSequence } from "@/components/sequences/NewSequence";

export const dynamic = "force-dynamic";

type Row = {
  slug: string; name: string; description: string | null;
  mode: "semi" | "full"; steps: { count: number }[];
};

export default async function SequencesPage() {
  const perms = await myPermissions();
  const may =
    perms.has("org.manage") || perms.has("finance.collections") || perms.has("nps.send");
  if (!may) redirect("/settings");

  const { data } = await createServiceClient()
    .from("sequences")
    .select("slug,name,description,mode,steps:sequence_steps(count)")
    .eq("active", true)
    .order("name");

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Sequences</h1>
        {perms.has("org.manage") && <div className="ml-auto"><NewSequence /></div>}
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        {rows.map((s) => (
          <Link
            key={s.slug}
            href={`/settings/sequences/${s.slug}`}
            className="flex items-center gap-3 border-b p-3 last:border-0 hover:bg-muted/40"
          >
            <div className="min-w-0">
              <div className="font-medium">{s.name}</div>
              <div className="truncate text-sm text-muted-foreground">{s.description}</div>
            </div>
            <div className="ml-auto shrink-0 text-sm text-muted-foreground">
              {s.steps?.[0]?.count ?? 0} steps ·{" "}
              {s.mode === "full" ? "sends" : "drafts"}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
