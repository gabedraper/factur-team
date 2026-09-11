import { redirect } from "next/navigation";
import { myPermissions, listMembers, listPodsAndClients } from "@/lib/org";
import { ClientsScreen } from "@/components/settings/ClientsScreen";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const [{ members }, { teams, clients }] = await Promise.all([
    listMembers(), listPodsAndClients(),
  ]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Clients" />
      <ClientsScreen clients={clients} teams={teams} members={members} />
    </div>
  );
}
