import { getArQueue, getArSettings, getArSteps } from "@/actions/ar";
import { getCollectionsSettings } from "@/actions/collections";
import { ArLadder } from "@/components/collections/ArLadder";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function ArLadderPage() {
  const perms = await myPermissions();
  if (!perms.has("finance.collections") && !perms.has("org.manage")) {
    return <NoAccess section="A/R ladder" need="Run collections" />;
  }

  const [rows, steps, settings, collections] = await Promise.all([
    getArQueue(),
    getArSteps(),
    getArSettings(),
    getCollectionsSettings(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <PageHeader back={{ href: "/collections", label: "Collections" }} title="A/R Ladder" />
      <ArLadder rows={rows} steps={steps} settings={settings} mode={collections.mode} />
    </div>
  );
}
