import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { PageUsageTable } from "@/components/settings/PageUsageTable";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Performance" />
      <PageUsageTable />
    </div>
  );
}
