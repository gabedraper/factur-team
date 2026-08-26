import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  myPermissions, getClientDetail, listMembers, listPodsAndClients, listServicesAndTeams,
} from "@/lib/org";
import { ClientDetail } from "@/components/settings/ClientDetail";
import { NpsPanel } from "@/components/clients/NpsPanel";
import { listNps } from "@/actions/nps";
import { ContactsPanel } from "@/components/clients/ContactsPanel";
import { listClientContacts } from "@/actions/client-contacts";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/settings");

  const detail = await getClientDetail((await params).clientId);
  if (!detail) notFound();

  const [{ members }, { teams }, { services }, nps, contacts] = await Promise.all([
    listMembers(), listPodsAndClients(), listServicesAndTeams(),
    listNps((await params).clientId),
    listClientContacts((await params).clientId),
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

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Contacts
        </h2>
        <div className="rounded-md border bg-card p-3">
          <ContactsPanel
            clientId={detail.client.id as string}
            contacts={contacts}
            canEdit={perms.has("org.manage")}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          NPS
        </h2>
        <div className="rounded-md border bg-card p-3">
          <NpsPanel
            clientId={detail.client.id as string}
            entries={nps}
            canEdit={perms.has("org.manage")}
          />
        </div>
      </section>
    </div>
  );
}
