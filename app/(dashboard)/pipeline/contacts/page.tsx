import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { previewedMemberId } from "@/lib/org";
import { ClientGroups } from "@/components/pipeline/ClientGroups";
import { BOTH_STAGE_FIELDS, type ClientRow, type PipelineScope, type StageFields } from "@/lib/pipeline/targets";

export const dynamic = "force-dynamic";

/*
 * Target Companies read the other way up.
 *
 * Identical shell -- the same clients, the same role hierarchy, the same
 * per-stage counts -- and a different list inside each client: the people being
 * chased, grouped by the company they work at, with the phone number and the
 * last note on the row.
 *
 * Companies answers "where do I spend the day". This answers "who do I ring".
 *
 * A static segment under /pipeline sits above [clientId] in Next's matching, so
 * this route wins and no client id can shadow it -- they are uuids in any case.
 */

export default async function TargetContactsPage() {
  await requirePipeline();
  const db = await createClient();

  const asMember = await previewedMemberId();

  const [{ data: scopeRows }, { data: clientRows }, { data: fieldRows }] = await Promise.all([
    db.rpc("pipeline_my_scope", { p_as_member: asMember }),
    db.rpc("pipeline_my_clients", { p_as_member: asMember }),
    db.rpc("my_stage_fields"),
  ]);

  const scope = ((scopeRows ?? [])[0] ?? {
    level: "rep", member_id: "", member_name: null,
  }) as PipelineScope;
  const rows = (clientRows ?? []) as ClientRow[];
  const stageFields = ((fieldRows ?? [])[0] ?? BOTH_STAGE_FIELDS) as StageFields;

  const pursuits = rows.reduce((n, r) => n + r.pursuits, 0);

  return (
    <ClientGroups
      title="Target Contacts"
      count={pursuits.toLocaleString()}
      scope={scope}
      rows={rows}
      stageFields={stageFields}
      view="contacts"
    />
  );
}
