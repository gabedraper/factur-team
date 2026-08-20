import { notFound } from "next/navigation";
import { getLeads, getFilterOptions } from "@/lib/timelines/leads";
import { TimelineBoard, type ViewKey } from "@/components/timelines/TimelineBoard";

// The staging tables are refreshed hourly by Coupler; there is nothing to gain
// from caching a render between loads.
export const dynamic = "force-dynamic";

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
  params: { view: string };
}) {
  const view = VIEW_BY_SLUG[params.view];
  if (!view) notFound();

  const [{ leads, generated, coldAfterDays }, { reps, clients }] = await Promise.all([
    getLeads({ limit: 150 }),
    getFilterOptions(),
  ]);

  return (
    <TimelineBoard
      view={view}
      leads={leads}
      reps={reps}
      clients={clients}
      generated={generated ?? new Date().toISOString()}
      coldAfterDays={coldAfterDays}
    />
  );
}
