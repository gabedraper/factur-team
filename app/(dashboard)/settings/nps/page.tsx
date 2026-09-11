import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { npsCoverage } from "@/actions/nps-readiness";
import { NpsReadiness } from "@/components/nps/NpsReadiness";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function NpsSettingsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const coverage = await npsCoverage();

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="NPS" />
      <Link
        href="/settings/nps/sequence"
        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        NPS Sequence <ChevronRight className="h-4 w-4" />
      </Link>
      <NpsReadiness coverage={coverage} />
    </div>
  );
}
