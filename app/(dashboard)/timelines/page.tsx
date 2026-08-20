import "./timelines.css";
import { getLeads, getFilterOptions } from "@/lib/timelines/leads";
import { TimelineBoard } from "@/components/timelines/TimelineBoard";

// The staging tables are refreshed hourly by Coupler; there is nothing to gain
// from caching a render between loads.
export const dynamic = "force-dynamic";

export default async function TimelinesPage() {
  const [{ leads, generated, coldAfterDays }, { reps, clients }] = await Promise.all([
    getLeads({ limit: 150 }),
    getFilterOptions(),
  ]);

  return (
    <TimelineBoard
      leads={leads}
      reps={reps}
      clients={clients}
      generated={generated ?? new Date().toISOString()}
      coldAfterDays={coldAfterDays}
    />
  );
}
