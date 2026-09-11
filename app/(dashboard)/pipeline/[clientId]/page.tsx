import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader } from "@/components/pipeline/bits";
import { TargetAccounts } from "@/components/pipeline/TargetAccounts";
import { listTargetAccounts } from "@/actions/pipeline-targets";
import { BOTH_STAGE_FIELDS, type StageFields } from "@/lib/pipeline/targets";

export const dynamic = "force-dynamic";

/*
 * One client's target companies.
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
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ account?: string }>;
}) {
  await requirePipeline();
  const { clientId } = await params;
  const { account: accountId } = await searchParams;

  const db = await createClient();
  const { data: client } = await db
    .from("org_clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) notFound();

  /* ?account= is where the header search sends a target company: this
     client's list, narrowed to that company by name, with its panel open. The
     name is the search because the list searches by name -- and the same
     name can belong to two companies, so the panel opens on the id. */
  const { data: account } = accountId
    ? await db.from("crm_accounts").select("id, name").eq("id", accountId).maybeSingle()
    : { data: null };
  const initialSearch = account?.name ?? "";

  const [{ rows, total }, { data: fieldRows }] = await Promise.all([
    listTargetAccounts({ clientId, search: initialSearch || undefined, limit: 50, offset: 0 }),
    db.rpc("my_stage_fields"),
  ]);
  const initialSelected = account ? rows.find((r) => r.account_id === account.id) ?? null : null;
  const stageFields = ((fieldRows ?? [])[0] ?? BOTH_STAGE_FIELDS) as StageFields;

  return (
    <div className="space-y-4">
      <Link
        href="/pipeline"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Target Companies
      </Link>

      <PageHeader title={client.name} count={total} />

      <TargetAccounts
        key={accountId ?? ""}
        clientId={clientId}
        clientName={client.name}
        initial={rows}
        initialTotal={total}
        initialSearch={initialSearch}
        initialSelected={initialSelected}
        stageFields={stageFields}
      />
    </div>
  );
}
