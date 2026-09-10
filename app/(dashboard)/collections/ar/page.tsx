import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getArQueue, getArSettings, getArSteps } from "@/actions/ar";
import { getCollectionsSettings } from "@/actions/collections";
import { ArLadder } from "@/components/collections/ArLadder";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

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
      <div>
        <Link
          href="/collections"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Collections
        </Link>
        <h1 className="mt-1 text-xl font-semibold">A/R Ladder</h1>
      </div>
      <ArLadder rows={rows} steps={steps} settings={settings} mode={collections.mode} />
    </div>
  );
}
