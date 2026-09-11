import { cookies } from "next/headers";
import { requirePipeline } from "@/lib/pipeline/access";
import { myPermissions } from "@/lib/org";
import { listViews } from "@/actions/opportunity-views";
import { OpportunityListViews } from "@/components/pipeline/OpportunityListViews";

export const dynamic = "force-dynamic";

/*
 * Opportunities, shaped like Salesforce on purpose.
 *
 * This used to open on "which client", which is a Factur idea -- an opportunity
 * only means something as one client's pursuit of one contact, so the client
 * came first. Salesforce does not work that way and neither do the habits of
 * anyone being moved off it: you pick a list view, and the view decides what
 * you see, client included. Client is a column and a filter here rather than a
 * gate in front of the list.
 *
 * The per-client route still exists and is still linked from the pipeline
 * screens; it is simply no longer the way in.
 *
 * No view, no query. Listing every opportunity is a sequential scan of 779,763
 * rows before any join or count -- roughly two seconds of database spent
 * answering a question nobody has asked yet -- so the list waits until a view
 * is chosen. The one exception is the view this browser used last, read from a
 * cookie here so it is known before the first paint and nobody watches the
 * wrong list appear and then swap.
 */

export default async function OpportunitiesPage() {
  await requirePipeline("view");
  const [views, perms, jar] = await Promise.all([listViews(), myPermissions(), cookies()]);
  const remembered = jar.get("opp_list_view")?.value ?? null;

  return (
    <div className="p-6">
      <OpportunityListViews
        views={views}
        canShare={perms.has("org.manage")}
        initialViewId={remembered}
      />
    </div>
  );
}
