import { spaces } from "@/actions/work-tree";
import { ContainerRows } from "@/components/work/ContainerRows";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * The workspace, top level.
 *
 * Deliberately the same shape as the ClickUp sidebar, in the same order,
 * because the fastest way to get somebody to stop opening ClickUp is for the
 * map in their head to keep working here.
 */
export default async function BrowsePage() {
  const perms = await myPermissions();
  if (!perms.has("work.view") && !perms.has("org.manage")) {
    return <NoAccess section="Work" need="View ClickUp work" />;
  }

  const items = await spaces();

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader back={{ href: "/work", label: "My work" }} title="Spaces" />

      <div className="rounded-lg border bg-card px-3 py-1">
        <ContainerRows items={items} />
      </div>
    </div>
  );
}
