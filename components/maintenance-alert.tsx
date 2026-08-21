import { AlertTriangle } from "lucide-react";
import { maintenanceHealth } from "@/lib/org";

/**
 * The "+vantage Corporation" outage ran for four hours before anyone noticed,
 * and only then because a page looked blank. This says so on every screen,
 * to the people who can fix it.
 */
export async function MaintenanceAlert({ canSee }: { canSee: boolean }) {
  if (!canSee) return null;

  const health = await maintenanceHealth();
  if (!health || health.healthy) return null;

  const stale = health.hours_since_success;

  return (
    <div className="flex items-start gap-2 border-b border-red-300 bg-red-100 px-4 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <b>Data is not refreshing.</b> {health.problem}.
        {stale !== null && (
          <> Last successful run {stale < 1 ? "under an hour" : `${stale} hours`} ago.</>
        )}{" "}
        Scoreboards and timelines will be showing stale numbers until this is fixed.
      </div>
    </div>
  );
}
