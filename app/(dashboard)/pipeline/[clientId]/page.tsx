import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader } from "@/components/pipeline/bits";
import { TargetAccounts } from "@/components/pipeline/TargetAccounts";
import { listTargetAccounts } from "@/actions/pipeline-targets";

export const dynamic = "force-dynamic";

/*
 * One client's target accounts.
 *
 * The first page is rendered on the server so the list is there on arrival;
 * every filter, search and page after that goes through the same server action
 * the client component calls. Two paths to the same query rather than two
 * queries.
 *
 * Access is not checked here beyond requirePipeline: RLS on opportunities
 * decides what the client can see, so a client id the viewer holds no role on
 * comes back with no accounts, and the name lookup below returns nothing.
 */

export default async function ClientTargetAccountsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  await requirePipeline();
  const { clientId } = await params;

  const db = await createClient();
  const { data: client } = await db
    .from("org_clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) notFound();

  const { rows, total } = await listTargetAccounts({
    clientId, openOnly: true, limit: 50, offset: 0,
  });

  return (
    <div className="space-y-4">
      <Link
        href="/pipeline"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Pipeline
      </Link>

      <PageHeader title={client.name} count={total} />

      <TargetAccounts
        clientId={clientId}
        clientName={client.name}
        initial={rows}
        initialTotal={total}
      />
    </div>
  );
}
