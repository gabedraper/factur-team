import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { myPermissions, listMembers, listPodsAndClients, listServicesAndTeams } from "@/lib/org";
import { ClientsScreen } from "@/components/settings/ClientsScreen";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [{ members }, { teams, clients }, { services }] = await Promise.all([
    listMembers(), listPodsAndClients(), listServicesAndTeams(),
  ]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Clients</h1>
      </div>
      <ClientsScreen clients={clients} teams={teams} members={members} services={services} />
    </div>
  );
}
