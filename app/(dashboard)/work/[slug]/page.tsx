import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { processWork, processesWithWork } from "@/actions/work";
import { WorkRows } from "@/components/work/WorkRows";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

/**
 * One process across every client.
 *
 * The view ClickUp cannot give without somebody building it by hand, because
 * over there the work is scattered across 209 client folders and here it is one
 * column on one table.
 */
export default async function ProcessBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("work.view") && !perms.has("org.manage")) {
    return <NoAccess section="Work" need="View ClickUp work" />;
  }

  const { slug } = await params;
  const [items, processes] = await Promise.all([processWork(slug), processesWithWork()]);
  const process = processes.find((p) => p.slug === slug);
  if (!process && items.length === 0) notFound();

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div>
        <Link
          href="/work"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> My work
        </Link>
        <div className="mt-1 flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">{process?.name ?? slug}</h1>
          <span className="text-xs tabular-nums text-muted-foreground">{items.length} open</span>
        </div>
      </div>

      <div className="rounded-lg border bg-card px-3 py-1">
        {items.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Nothing open.</p>
        ) : (
          <WorkRows items={items} show={{ client: true }} />
        )}
      </div>
    </div>
  );
}
