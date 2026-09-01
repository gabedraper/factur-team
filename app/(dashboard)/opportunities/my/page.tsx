import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader, Panel, Empty, AlphaFilter } from "@/components/pipeline/bits";

export const dynamic = "force-dynamic";

/*
 * My Opportunities starts with "which client" -- an opportunity only means
 * anything in the context of one client's pursuit of a contact, so jumping
 * straight to a flat cross-client list would bury that. Factur's own sales
 * (selling Factur Outsourced Prospecting) only ever has the one client, so
 * this skips straight through rather than making that one choice pointless.
 */
export default async function MyOpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ letter?: string }>;
}) {
  await requirePipeline("view");
  const { letter } = await searchParams;
  const supabase = await createClient();

  // Real DISTINCT, not a capped sample -- see my_pursuit_clients() for why
  // that matters once one client alone can carry tens of thousands of rows.
  const { data } = await supabase.rpc("my_pursuit_clients");
  const allClients = ((data as { client_id: string; name: string }[] | null) ?? [])
    .map((r) => ({ id: r.client_id, name: r.name }));

  if (allClients.length === 1) redirect(`/opportunities/my/${allClients[0].id}`);

  // Already fetched in full (small, all-clients set) -- filtering the
  // already-fetched list in memory rather than re-querying for one letter.
  const clients = letter ? allClients.filter((c) => c.name.toUpperCase().startsWith(letter)) : allClients;

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="My Opportunities" count={allClients.length} />
      <AlphaFilter active={letter ?? null} hrefFor={(l) => (l ? `/opportunities/my?letter=${l}` : "/opportunities/my")} />
      <Panel>
        {clients.length === 0 ? (
          <Empty>{allClients.length === 0 ? "No opportunities open against any client yet." : "No clients match that letter."}</Empty>
        ) : (
          <ul className="divide-y">
            {clients.map((c) => (
              <li key={c.id}>
                <Link href={`/opportunities/my/${c.id}`} className="block px-4 py-3 text-sm font-medium hover:bg-muted/30">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
