import { redirect } from "next/navigation";
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
      <h1 className="text-xl font-semibold">Collections</h1>
      <Board rows={rows} settings={settings} visibility={visibility} scope={scope} />
    </div>
  );
}
