import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions } from "@/lib/org";
import { listUnmatchedQuickbooks, listClientsForLinking } from "@/actions/quickbooks-links";
import { QuickbooksLinks } from "@/components/settings/QuickbooksLinks";

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
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">QuickBooks customers</h1>
      </div>
      <QuickbooksLinks rows={rows} clients={clients} canDecide={perms.has("org.manage")} />
    </div>
  );
}
