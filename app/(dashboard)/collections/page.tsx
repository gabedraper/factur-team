import { redirect } from "next/navigation";
import {
  getCollectionsBoard, getCollectionsSettings, getCollectionsVisibility,
} from "@/actions/collections";
import { Board } from "@/components/collections/Board";
import { clientDomains } from "@/lib/org";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const visibility = await getCollectionsVisibility();

  /*
   * A check that failed is not the same answer as "no". Sending somebody home
   * because the database blinked tells them the page is not theirs, which is
   * both untrue and impossible to argue with.
   */
  if (visibility.problem) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-xl font-semibold">Collections</h1>
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Couldn’t check what you can see. {visibility.problem}
        </p>
      </div>
    );
  }

  // On no client and entitled to see nothing: this page is not theirs at all.
  if (!visibility.can_see_all && !visibility.attached) redirect("/");

  // Somebody who can see everything gets everything to start with; somebody
  // who cannot has only their own either way.
  const asked = (await searchParams).scope;
  const scope: "mine" | "all" =
    asked === "mine" ? "mine" : asked === "all" ? "all" : visibility.can_see_all ? "all" : "mine";

  const [rows, domains, settings] = await Promise.all([
    getCollectionsBoard(scope),
    clientDomains(),
    getCollectionsSettings(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <h1 className="text-xl font-semibold">Collections</h1>
      <Board rows={rows} settings={settings} visibility={visibility} scope={scope} domains={domains} />
    </div>
  );
}
