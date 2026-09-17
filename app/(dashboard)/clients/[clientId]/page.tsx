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
import { getCollectionsSmsTarget } from "@/actions/collections";
import { Conversation } from "@/components/clients/Conversation";
import { BillingSummary } from "@/components/clients/BillingSummary";
import { Notes } from "@/components/clients/Notes";
import { ClientWorkPanel } from "@/components/work/ClientWorkPanel";
import { AgreementPanel } from "@/components/clients/AgreementPanel";
import { ContactsPanel } from "@/components/clients/ContactsPanel";
import { NpsPanel } from "@/components/clients/NpsPanel";
import { HistoryPanel } from "@/components/clients/HistoryPanel";
import { CollectionsSmsPanel } from "@/components/clients/CollectionsSmsPanel";
import { CommercePanel, type CommerceMonth } from "@/components/clients/CommercePanel";
import { browseCommerce } from "@/lib/commerce/browse";
import { createClient } from "@/lib/supabase/server";
import { ClientDetail } from "@/components/settings/ClientDetail";
import { myPermissions, getClientDetail, listMembers } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-body font-semibold uppercase tracking-wide text-muted-foreground">
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
  const smsAllowed = admin || perms.has("finance.collections.sms");

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

  const smsTarget = smsAllowed ? await getCollectionsSmsTarget(clientId) : null;

  const people = (members?.members ?? [])
    .filter((m) => m.active)
    .map((m) => ({ id: m.id, name: m.full_name ?? m.email }))
    .sort((a, b) => a.name.localeCompare(b.name));

  /* Quotes and purchase orders: the six-month line and the most recent of
     each. Read through the person's own client, so the same policy applies as
     on the opportunities they hang off. */
  const [{ data: commerceMonths }, recentQuotes, recentOrders] = await Promise.all([
    (await createClient())
      .from("client_commerce_months")
      .select("month_start,quotes,quotes_total,orders,orders_total")
      .eq("client_id", clientId)
      .order("month_start", { ascending: false }),
    browseCommerce({ kind: "quotes", clientId, limit: 8 }),
    browseCommerce({ kind: "orders", clientId, limit: 8 }),
  ]);

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div>
        <Link
          href="/clients/health"
          className="inline-flex items-center gap-1 text-body text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Client Health
        </Link>
        <PageHeader
          title={(client as { name: string }).name}
          actions={<Link
            href={`/clients/${clientId}/market`}
            className="text-body text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Market
          </Link>}
          className="mt-1"
        />
      </div>

      {billing && <BillingSummary summary={billing} />}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-6">
        <div className="space-y-4">
          <ClientWorkPanel groups={work} />
          <Notes clientId={clientId} notes={notes} />
          <Conversation entries={entries} clientId={clientId} />
        </div>

        <div className="space-y-8">
          <Section title="Agreement">
            <AgreementPanel clientId={clientId} agreement={agreement} />
          </Section>

          <Section title="Contacts">
            <Surface pad="tight">
              <ContactsPanel clientId={clientId} contacts={contacts} canEdit={admin} />
            </Surface>
          </Section>

          <Section title="Quotes & POs">
            <Surface pad="tight">
              <CommercePanel
                clientId={clientId}
                months={(commerceMonths ?? []) as CommerceMonth[]}
                quotes={recentQuotes.rows}
                orders={recentOrders.rows}
              />
            </Surface>
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
              <Surface pad="tight">
                <HistoryPanel spans={roleHistory} />
              </Surface>
            </Section>
          )}

          {nps && (
            <Section title="NPS">
              <Surface pad="tight">
                <NpsPanel clientId={clientId} entries={nps} canEdit={admin} />
              </Surface>
            </Section>
          )}

          {smsTarget && (
            <Section title="Collections texting">
              <Surface pad="tight">
                <CollectionsSmsPanel clientId={clientId} target={smsTarget} />
              </Surface>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
