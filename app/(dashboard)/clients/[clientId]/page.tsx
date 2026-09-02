import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { getConversation } from "@/actions/conversation";
import { getBillingSummary } from "@/actions/billing";
import { getClientNotes } from "@/actions/client-notes";
import { clientWork } from "@/actions/work";
import { getClientAgreement } from "@/actions/client-agreement";
import { listClientContacts } from "@/actions/client-contacts";
import { listNps } from "@/actions/nps";
import { clientHistory } from "@/actions/client-history";
import { Conversation } from "@/components/clients/Conversation";
import { BillingSummary } from "@/components/clients/BillingSummary";
import { Notes } from "@/components/clients/Notes";
import { WorkPanel } from "@/components/work/WorkPanel";
import { AgreementPanel } from "@/components/clients/AgreementPanel";
import { ContactsPanel } from "@/components/clients/ContactsPanel";
import { NpsPanel } from "@/components/clients/NpsPanel";
import { HistoryPanel } from "@/components/clients/HistoryPanel";
import { ClientDetail } from "@/components/settings/ClientDetail";
import { myPermissions, getClientDetail, listMembers } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function ClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) {
    return <NoAccess section="Client health" need="View client health" />;
  }

  const { clientId } = await params;
  const admin = perms.has("org.manage");

  const { data: client } = await createServiceClient()
    .from("org_clients")
    .select("id,name,status")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) notFound();

  /*
   * The record half is what somebody who runs the org may change; the activity
   * half is what anybody on the client may read. Only fetch the first for the
   * first sort of person, so a normal viewer does not pay for a member list
   * they will never be shown.
   */
  const [entries, billing, notes, work, agreement, contacts] = await Promise.all([
    getConversation(clientId),
    getBillingSummary(clientId),
    getClientNotes(clientId),
    clientWork(clientId),
    getClientAgreement(clientId),
    listClientContacts(clientId),
  ]);

  const [detail, members, nps, roleHistory] = admin
    ? await Promise.all([
        getClientDetail(clientId),
        listMembers(),
        listNps(clientId),
        clientHistory(clientId),
      ])
    : [null, null, null, null];

  const people = (members?.members ?? [])
    .filter((m) => m.active)
    .map((m) => ({ id: m.id, name: m.full_name ?? m.email }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div>
        <Link
          href="/clients/health"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Client Health
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{(client as { name: string }).name}</h1>
      </div>

      {billing && <BillingSummary summary={billing} />}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-6">
        <div className="space-y-4">
          <WorkPanel groups={work} />
          <Notes clientId={clientId} notes={notes} />
          <Conversation entries={entries} clientId={clientId} />
        </div>

        <div className="space-y-8">
          <Section title="Agreement">
            <AgreementPanel clientId={clientId} agreement={agreement} />
          </Section>

          <Section title="Contacts">
            <div className="rounded-md border bg-card p-3">
              <ContactsPanel clientId={clientId} contacts={contacts} canEdit={admin} />
            </div>
          </Section>

          {detail && (
            <Section title="Team & Salesforce">
              <ClientDetail
                client={detail.client}
                salesforce={detail.salesforce}
                team={detail.team}
                people={people}
                roles={detail.roles}
                assignments={detail.assignments}
              />
            </Section>
          )}

          {roleHistory && (
            <Section title="Who has been on this client">
              <div className="rounded-md border bg-card p-3">
                <HistoryPanel spans={roleHistory} />
              </div>
            </Section>
          )}

          {nps && (
            <Section title="NPS">
              <div className="rounded-md border bg-card p-3">
                <NpsPanel clientId={clientId} entries={nps} canEdit={admin} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
