import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { getSteps, getCollectionsSettings } from "@/actions/collections";
import { Sequence } from "@/components/collections/Sequence";

export const dynamic = "force-dynamic";

export default async function CollectionsSequencePage() {
  const perms = await myPermissions();
  if (!perms.has("finance.collections") && !perms.has("org.manage")) redirect("/settings");

  const [steps, settings] = await Promise.all([getSteps(), getCollectionsSettings()]);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link
          href="/collections"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Collections
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Billing / Collections Sequence</h1>
      </div>
      <Sequence steps={steps} settings={settings} />
    </div>
  );
}
