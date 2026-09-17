import { requirePipeline } from "@/lib/pipeline/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { CommerceBrowser } from "@/components/data/CommerceBrowser";
import { browseCommerce, commerceStatuses } from "@/lib/commerce/browse";

export const dynamic = "force-dynamic";

type Search = { q?: string; client?: string; status?: string; page?: string };

export default async function PurchaseordersDataPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePipeline("view");
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const [{ rows, hasMore }, statuses, client] = await Promise.all([
    browseCommerce({ kind: "orders", q: sp.q, clientId: sp.client ?? null, status: sp.status ?? null, page }),
    commerceStatuses("orders"),
    sp.client
      ? (await createClient()).from("org_clients").select("name").eq("id", sp.client).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        title="Purchase orders"
        count={`${rows.length}${hasMore ? "+" : ""}`}
        back={sp.client ? { href: `/clients/${sp.client}`, label: (client.data as { name: string } | null)?.name ?? "Client" } : { href: "/data", label: "Data" }}
      />
      <CommerceBrowser
        kind="orders"
        rows={rows}
        hasMore={hasMore}
        page={page}
        basePath="/data/orders"
        params={{ q: sp.q, client: sp.client, status: sp.status }}
        statuses={statuses}
        clientName={(client.data as { name: string } | null)?.name ?? null}
      />
    </div>
  );
}
