import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { listClientsForSelf } from "@/actions/self-service";
import { PageHeader, Panel, Empty, Chip, stageTone } from "@/components/pipeline/bits";
import { NewOpportunityDialog } from "@/components/pipeline/NewOpportunityDialog";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  stage: string;
  lead_status: string | null;
  next_action_date: string | null;
  org_clients: { name: string } | null;
  crm_contacts: { first_name: string | null; last_name: string | null } | null;
  crm_accounts: { name: string } | null;
};

export default async function PipelinePage() {
  await requirePipeline("view");
  const supabase = await createClient();

  // RLS (opportunities_scoped) already limits this to the caller's clients,
  // or every client for org.manage — no manual client_id filter needed here.
  const [{ data, error }, clients] = await Promise.all([
    supabase
      .from("opportunities")
      .select(
        "id,name,stage,lead_status,next_action_date,org_clients(name),crm_contacts(first_name,last_name),crm_accounts(name)"
      )
      .order("next_action_date", { ascending: true, nullsFirst: false })
      .limit(200),
    listClientsForSelf(),
  ]);

  const rows = (error ? [] : (data as unknown as Row[])) ?? [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Pipeline" count={rows.length}>
        <NewOpportunityDialog clients={clients} />
      </PageHeader>

      <Panel>
        {rows.length === 0 ? (
          <Empty>No pursuits are open against your clients right now.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/pipeline/${r.id}`} className="font-medium hover:underline">
                      {[r.crm_contacts?.first_name, r.crm_contacts?.last_name].filter(Boolean).join(" ") || r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.crm_accounts?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.org_clients?.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Chip colour={stageTone(r.stage)}>{r.stage}</Chip>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                    {r.next_action_date ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
