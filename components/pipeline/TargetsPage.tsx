import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requirePipeline } from "@/lib/pipeline/access";
import { previewedMemberId, clientDomains } from "@/lib/org";
import { resolveViews, clientIdsForScope } from "@/lib/list-views/resolve";
import { PageHeader } from "@/components/ui/page-header";
import { ViewSwitcher } from "@/components/list/ViewSwitcher";
import { ClientGroups, type ClientView } from "@/components/pipeline/ClientGroups";
import { BOTH_STAGE_FIELDS, type ClientRow, type PipelineScope, type StageFields } from "@/lib/pipeline/targets";

/*
 * Target Companies and Target Contacts: the same page read two ways up, so one
 * body for both. The list shell -- title, view chips, rows -- is the one every
 * list uses, and the views are the ones everyone gets:
 *
 *   All       every client you can reach, which is what RLS returns
 *   My        clients you are named on yourself
 *   My team's the same, down your reporting line
 *   a client  that one client, opened -- behind "More…"
 *
 * Every client comes back in one call and the view narrows it here, in
 * memory. That is a few hundred rows, and it keeps the client ids out of a
 * query string, where a senior manager's thousand would not fit.
 */

type Search = { scope?: string; client?: string };

export async function TargetsPage({
  view,
  searchParams,
}: {
  view: ClientView;
  searchParams: Promise<Search>;
}) {
  await requirePipeline();
  const sp = await searchParams;
  const scope = sp.scope === "mine" || sp.scope === "team" ? sp.scope : null;
  const db = await createClient();

  /* "Viewing as" is a cookie the Next layer reads; the database still sees the
     signed-in person, so the previewed member has to be handed over explicitly
     or previewing a rep shows the previewer their own screen. Both functions
     re-check that the caller really holds org.manage before honouring it. */
  const asMember = await previewedMemberId();

  const [views, domains, scopeIds, { data: scopeRows }, { data: clientRows, error }, { data: fieldRows }] =
    await Promise.all([
      resolveViews(view === "contacts" ? "contacts" : "accounts"),
      clientDomains(),
      scope ? clientIdsForScope(scope) : Promise.resolve(null),
      db.rpc("pipeline_my_scope", { p_as_member: asMember }),
      db.rpc("pipeline_my_clients", { p_as_member: asMember }),
      db.rpc("my_stage_fields"),
    ]);

  const pipelineScope = ((scopeRows ?? [])[0] ?? {
    level: "rep", member_id: "", member_name: null,
  }) as PipelineScope;
  const stageFields = ((fieldRows ?? [])[0] ?? BOTH_STAGE_FIELDS) as StageFields;

  const inScope = scopeIds ? new Set(scopeIds) : null;
  const rows = ((clientRows ?? []) as ClientRow[]).filter(
    (r) => (!inScope || inScope.has(r.client_id)) && (!sp.client || r.client_id === sp.client),
  );

  const total = rows.reduce((n, r) => n + (view === "contacts" ? r.pursuits : r.companies), 0);

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        title={view === "contacts" ? "Target contacts" : "Target companies"}
        count={error ? undefined : total.toLocaleString()}
      />
      <Suspense fallback={<div className="h-7" />}>
        <ViewSwitcher
          entity={view === "contacts" ? "contacts" : "accounts"}
          pinned={views.pinned}
          rest={views.rest}
        />
      </Suspense>
      <ClientGroups
        /* A new view is a new list: reset what was open and what was picked. */
        key={`${scope ?? ""}:${sp.client ?? ""}`}
        scope={pipelineScope}
        rows={rows}
        stageFields={stageFields}
        view={view}
        domains={domains}
        initialOpen={sp.client ?? null}
        error={error?.message ?? null}
      />
    </div>
  );
}
