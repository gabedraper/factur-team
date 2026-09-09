import Link from "next/link";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader, Panel, Empty, Chip } from "@/components/pipeline/bits";

export const dynamic = "force-dynamic";

/*
 * Where the pipeline starts: pick a client, then work their companies.
 *
 * Distinct from /opportunities/my, which lists pursuits — one row per person
 * being chased. This side is company-first, because that is how the work is
 * actually done: you decide which company to get into, then work out who at it
 * will let you in.
 *
 * RLS on opportunities decides what appears. A client with no pursuits the
 * viewer can see simply is not on the list.
 */

type ClientRow = {
  client_id: string;
  name: string;
  status: string | null;
  active: boolean;
  target_accounts: number;
  open_accounts: number;
  open_contacts: number;
  next_action_date: string | null;
};

export default async function PipelineClientsPage() {
  await requirePipeline();
  const db = await createClient();
  const { data } = await db.rpc("pipeline_clients");
  const clients = (data ?? []) as ClientRow[];

  const live = clients.filter((c) => c.active);
  const former = clients.filter((c) => !c.active);

  return (
    <div className="space-y-4">
      <PageHeader title="Pipeline" count={clients.length} />
      <ClientTable rows={live} />
      {former.length > 0 && (
        <Panel title="Former clients">
          <ClientTable rows={former} bare />
        </Panel>
      )}
    </div>
  );
}

function ClientTable({ rows, bare = false }: { rows: ClientRow[]; bare?: boolean }) {
  const table = rows.length === 0 ? (
    <Empty>No clients.</Empty>
  ) : (
    <table className="w-full text-sm">
      <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-4 py-2 font-medium">Client</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 text-right font-medium">Open accounts</th>
          <th className="px-4 py-2 text-right font-medium">Open contacts</th>
          <th className="px-4 py-2 font-medium">Next action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.client_id} className="border-b last:border-0 hover:bg-muted/30">
            <td className="px-4 py-2">
              <Link href={`/pipeline/${c.client_id}`} className="flex items-center gap-2 font-medium hover:underline">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {c.name}
              </Link>
            </td>
            <td className="px-4 py-2">
              {c.status ? <Chip colour={c.active ? "emerald" : "slate"}>{c.status}</Chip> : null}
            </td>
            <td className="px-4 py-2 text-right tabular-nums">
              {c.open_accounts.toLocaleString()}
              {c.target_accounts > c.open_accounts && (
                <span className="ml-1 text-xs text-muted-foreground">
                  / {c.target_accounts.toLocaleString()}
                </span>
              )}
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{c.open_contacts.toLocaleString()}</td>
            <td className="px-4 py-2 tabular-nums">
              {c.next_action_date
                ? new Date(c.next_action_date).toLocaleDateString(undefined, { day: "numeric", month: "short" })
                : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return bare ? table : <Panel>{table}</Panel>;
}
