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
 * RLS decides the rows. A view with no filters is every opportunity the viewer
 * can see, which is exactly what it should be.
 */

export default async function OpportunitiesPage() {
  await requirePipeline("view");
  const [views, perms] = await Promise.all([listViews(), myPermissions()]);

  return (
    <div className="p-6">
      <OpportunityListViews views={views} canShare={perms.has("org.manage")} />
    </div>
  );
}
