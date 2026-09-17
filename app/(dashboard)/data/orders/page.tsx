import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader } from "@/components/ui/page-header";
import { CommerceBrowser } from "@/components/data/CommerceBrowser";
import { browseCommerce, commerceStatuses } from "@/lib/commerce/browse";
import { clientDirectory, clientPicklists } from "@/lib/clients/directory";

export const dynamic = "force-dynamic";

type Search = { q?: string; client?: string; status?: string; am?: string; lead?: string; page?: string };

/*
 * Account manager and team lead are answered through the client directory --
 * the same rows and the same "who covers this client" rule as Data > Clients,
 * including a team lead inherited from the account manager's manager -- and
 * the purchase orders are then narrowed to those clients' ids. One definition of
 * cover, wherever it is asked.
 */
export default async function PurchaseordersDataPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePipeline("view");
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const { rows: directory } = await clientDirectory({ scope: null });
  const picklists = clientPicklists(directory);
  const covered = sp.am || sp.lead
    ? directory
        .filter((c) => (!sp.am || c.account_manager === sp.am) && (!sp.lead || c.team_lead === sp.lead))
        .map((c) => c.id)
    : null;

  const [{ rows, hasMore }, statuses] = await Promise.all([
    browseCommerce({ kind: "orders", q: sp.q, clientId: sp.client ?? null, clientIds: covered, status: sp.status ?? null, page }),
    commerceStatuses("orders"),
  ]);
  /* Every client, whether or not it has any -- picking one with none is a
     real answer ("no purchase orders for this client"), not a dead end to hide. */
  const clients = directory
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const clientName = sp.client ? clients.find((c) => c.id === sp.client)?.name ?? null : null;

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        title="Purchase orders"
        count={`${rows.length}${hasMore ? "+" : ""}`}
        back={sp.client ? { href: `/clients/${sp.client}`, label: clientName ?? "Client" } : { href: "/data", label: "Data" }}
      />
      <CommerceBrowser
        kind="orders"
        rows={rows}
        hasMore={hasMore}
        page={page}
        basePath="/data/orders"
        params={{ q: sp.q, client: sp.client, status: sp.status, am: sp.am, lead: sp.lead }}
        clientName={clientName}
        statuses={statuses}
        clients={clients}
        accountManagers={picklists.account_manager ?? []}
        teamLeads={picklists.team_lead ?? []}
      />
    </div>
  );
}
