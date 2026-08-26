import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { getCollectionsQueue, getCollectionsSettings } from "@/actions/collections";
import { Queue } from "@/components/collections/Queue";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const perms = await myPermissions();
  if (!perms.has("finance.collections") && !perms.has("org.manage")) redirect("/");

  const [rows, settings] = await Promise.all([
    getCollectionsQueue(),
    getCollectionsSettings(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Collections</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full border px-2 py-0.5 text-xs">
            {settings.mode === "full" ? "Full auto" : "Semi-auto"}
          </span>
          <Link
            href="/settings/collections"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" /> Sequence
          </Link>
        </div>
      </div>
      <Queue rows={rows} settings={settings} />
    </div>
  );
}
