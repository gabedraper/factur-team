import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { containerWithPath, children, listItems } from "@/actions/work-tree";
import { ContainerRows } from "@/components/work/ContainerRows";
import { WorkRows } from "@/components/work/WorkRows";
import { KIND_LABEL } from "@/lib/work-tree";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

/**
 * One space, folder or list.
 *
 * All three are the same page because in ClickUp they are the same gesture --
 * you click a thing in the sidebar and its contents appear. A space and a
 * folder show what is inside them; a list shows its tasks. Splitting this into
 * three routes would buy nothing and would have to be kept consistent forever.
 */
export default async function ContainerPage({
  params,
}: {
  params: Promise<{ containerId: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("work.view") && !perms.has("org.manage")) {
    return <NoAccess section="Work" need="View ClickUp work" />;
  }

  const { containerId } = await params;
  const found = await containerWithPath(containerId);
  if (!found) notFound();

  const { node, path } = found;
  const isList = node.kind === "list";
  const [kids, items] = await Promise.all([
    isList ? Promise.resolve([]) : children(containerId),
    isList ? listItems(containerId) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <div>
        <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link href="/work/browse" className="hover:text-foreground">Spaces</Link>
          {path.map((crumb) => (
            <span key={crumb.clickupId} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <Link href={`/work/browse/${crumb.clickupId}`} className="hover:text-foreground">
                {crumb.name}
              </Link>
            </span>
          ))}
        </nav>

        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">{node.name}</h1>
          <div className="flex items-baseline gap-3 text-xs text-muted-foreground">
            <span>{KIND_LABEL[node.kind]}</span>
            {isList && (
              <span className="tabular-nums">
                {items.length} mirrored · {node.taskCount} in ClickUp
              </span>
            )}
            {node.url && isList && (
              <a
                href={node.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                ClickUp <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card px-3 py-1">
        {isList ? (
          items.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No tasks mirrored.</p>
          ) : (
            <WorkRows items={items} show={{ client: true }} />
          )
        ) : (
          <ContainerRows items={kids} />
        )}
      </div>
    </div>
  );
}
