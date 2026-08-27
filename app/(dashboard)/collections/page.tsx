import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import {
  getCollectionsBoard, getCollectionsSettings, getCollectionsVisibility,
} from "@/actions/collections";
import { Board } from "@/components/collections/Board";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const visibility = await getCollectionsVisibility();

  // On no client and entitled to see nothing: this page is not theirs at all.
  if (!visibility.can_see_all && !visibility.attached) redirect("/");

  // Somebody who can see everything gets everything to start with; somebody
  // who cannot has only their own either way.
  const asked = (await searchParams).scope;
  const scope: "mine" | "all" =
    asked === "mine" ? "mine" : asked === "all" ? "all" : visibility.can_see_all ? "all" : "mine";

  const [rows, settings] = await Promise.all([
    getCollectionsBoard(scope),
    getCollectionsSettings(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Collections</h1>
        {visibility.can_act && (
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-full border px-2 py-0.5 text-xs">
              {settings.mode === "full" ? "Full auto" : "Semi-auto"}
            </span>
            <Link
              href="/settings/collections"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-4 w-4" /> Billing / Collections Sequence
            </Link>
          </div>
        )}
      </div>
      <Board rows={rows} settings={settings} visibility={visibility} scope={scope} />
    </div>
  );
}
