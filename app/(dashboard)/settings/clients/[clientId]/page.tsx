import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  myPermissions, getClientDetail, listMembers, listPodsAndClients, listServicesAndTeams,
} from "@/lib/org";
import { ClientDetail } from "@/components/settings/ClientDetail";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: { clientId: string } }) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const detail = await getClientDetail(params.clientId);
  if (!detail) notFound();

  const [{ members }, { teams }, { services }] = await Promise.all([
    listMembers(), listPodsAndClients(), listServicesAndTeams(),
  ]);

  const people = members
    .filter((m) => m.active)
    .map((m) => ({ id: m.id, name: m.full_name ?? m.email }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const pods = teams
    .filter((t) => t.kind === "pod" && t.active)
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link href="/settings/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Clients
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{String(detail.client.name)}</h1>
      </div>

      <ClientDetail
        client={detail.client}
        salesforce={detail.salesforce}
        team={detail.team}
        people={people}
        pods={pods}
        services={services}
      />
    </div>
  );
}
