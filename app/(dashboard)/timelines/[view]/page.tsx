import { notFound } from "next/navigation";
import { getLeads, getFilterOptions } from "@/lib/timelines/leads";
import { myPermissions } from "@/lib/org";
import { TimelineBoard, type ViewKey } from "@/components/timelines/TimelineBoard";

// The staging tables are refreshed hourly by Coupler; there is nothing to gain
// from caching a render between loads.
export const dynamic = "force-dynamic";

// The tile rebuild runs after the response on whichever visit finds them stale,
// and reads a year of leads and activity. It needs longer than a page render.
export const maxDuration = 300;

// The three views are routes rather than in-page state, so each is a nav link
// and a shareable URL.
const VIEW_BY_SLUG: Record<string, ViewKey> = {
  "quick-response": "quick",
  "follow-up": "week",
  "full-life": "life",
};

export default async function TimelinesViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const view = VIEW_BY_SLUG[(await params).view];
  if (!view) notFound();

  const [
    { leads, summaries, held, generated, coldAfterDays, scope, summaryWindowFrom },
    { reps, clients, showRepFilter },
    perms,
  ] = await Promise.all([getLeads(), getFilterOptions(), myPermissions()]);

  return (
    <TimelineBoard
      view={view}
      leads={leads}
      summaries={summaries}
      held={held}
      reps={reps}
      clients={clients}
      generated={generated ?? new Date().toISOString()}
      coldAfterDays={coldAfterDays}
      summaryWindowFrom={summaryWindowFrom}
      showRepFilter={showRepFilter}
      scope={scope}
      canManageOrg={perms.has("org.manage")}
    />
  );
}
