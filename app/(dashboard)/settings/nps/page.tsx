import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { npsCoverage } from "@/actions/nps-readiness";
import { NpsReadiness } from "@/components/nps/NpsReadiness";

export const dynamic = "force-dynamic";

export default async function NpsSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const coverage = await npsCoverage();

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">NPS</h1>
      </div>
      <NpsReadiness coverage={coverage} />
    </div>
  );
}
