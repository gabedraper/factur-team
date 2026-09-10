import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { PageHeader } from "@/components/pipeline/bits";
import { ClientGroups } from "@/components/pipeline/ClientGroups";
import type { ClientRow, PipelineScope } from "@/lib/pipeline/targets";

export const dynamic = "force-dynamic";

/*
 * Where the work starts: the companies you are trying to get into, under the
 * people responsible for them.
 *
 * Distinct from /opportunities/my, which lists pursuits -- one row per person
 * being chased. This side is company-first, because that is how the work is
 * actually done: you decide which company to get into, then work out who at it
 * will let you in.
 *
 * Every client the viewer can reach comes back in one call and the nesting
 * happens in the browser. That is deliberate: even a manager sees a few hundred
 * clients, which is nothing to hold in memory and everything to a screen that
 * would otherwise round-trip once per group as it is opened.
 *
 * RLS decides what is here. A client with no pursuits the viewer can see simply
 * is not on the list.
 */

export default async function TargetCompaniesPage() {
  await requirePipeline();
  const db = await createClient();

  const [{ data: scopeRows }, { data: clientRows }] = await Promise.all([
    db.rpc("pipeline_my_scope"),
    db.rpc("pipeline_my_clients"),
  ]);

  const scope = ((scopeRows ?? [])[0] ?? {
    level: "rep", member_id: "", member_name: null,
  }) as PipelineScope;
  const rows = (clientRows ?? []) as ClientRow[];

  const companies = rows.reduce((n, r) => n + r.open_companies, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Target Companies" count={companies.toLocaleString()} />
      <ClientGroups scope={scope} rows={rows} />
    </div>
  );
}
