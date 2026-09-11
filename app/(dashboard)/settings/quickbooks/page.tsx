import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { listUnmatchedQuickbooks, listClientsForLinking } from "@/actions/quickbooks-links";
import { QuickbooksLinks } from "@/components/settings/QuickbooksLinks";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function QuickbooksPage() {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) redirect("/settings");

  const [rows, clients] = await Promise.all([
    listUnmatchedQuickbooks(),
    listClientsForLinking(),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="QuickBooks customers" />
      <QuickbooksLinks rows={rows} clients={clients} canDecide={perms.has("org.manage")} />
    </div>
  );
}
