import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader, Panel, Empty } from "@/components/pipeline/bits";

export const dynamic = "force-dynamic";

/*
 * My Opportunities starts with "which client" -- a pursuit only means
 * anything in the context of one client's pursuit of a contact, so jumping
 * straight to a flat cross-client list would bury that. Factur's own sales
 * (selling Factur Outsourced Prospecting) only ever has the one client, so
 * this skips straight through rather than making that one choice pointless.
 */
export default async function MyOpportunitiesPage() {
  await requirePipeline("view");
  const supabase = await createClient();

  // Real DISTINCT, not a capped sample -- see my_pursuit_clients() for why
  // that matters once one client alone can carry tens of thousands of rows.
  const { data } = await supabase.rpc("my_pursuit_clients");
  const clients = ((data as { client_id: string; name: string }[] | null) ?? [])
    .map((r) => ({ id: r.client_id, name: r.name }));

  if (clients.length === 1) redirect(`/opportunities/my/${clients[0].id}`);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="My Opportunities" />
      <Panel>
        {clients.length === 0 ? (
          <Empty>No pursuits open against any client yet.</Empty>
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
