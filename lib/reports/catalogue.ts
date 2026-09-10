import type { Permission } from "@/lib/org";
import { arAgeing } from "./defs/ar-ageing";
import { clientHealth } from "./defs/client-health";
import { clientResults } from "./defs/client-results";
import { hustlePoints } from "./defs/hustle-points";
import { npsResponses } from "./defs/nps-responses";
import { talentActivity } from "./defs/talent-activity";
import { trainingProgress } from "./defs/training-progress";
import { mayOpen } from "./run";
import { GROUPS, type AnyReport, type Group } from "./types";

/**
 * Which reports exist.
 *
 * To add one: write a definition under `defs/` (see `types.ts` for the shape)
 * and list it here. The index page, the report page, the filter bar, the
 * sorting, the empty states and the CSV all come from the definition. There
 * is no page to write and nothing else to register.
 *
 * Order within a group is the order on the index page.
 */
export const REPORTS: AnyReport[] = [
  clientHealth,
  clientResults,
  npsResponses,
  arAgeing,
  hustlePoints,
  talentActivity,
  trainingProgress,
];

const BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

export function reportByKey(key: string): AnyReport | null {
  return BY_KEY.get(key) ?? null;
}

/** The reports this person may open, grouped, in index order. Empty groups are left out. */
export function reportsFor(perms: Set<string>): { group: Group; reports: AnyReport[] }[] {
  return GROUPS
    .map((group) => ({
      group,
      reports: REPORTS.filter((r) => r.group === group && mayOpen(r, perms)),
    }))
    .filter((g) => g.reports.length > 0);
}

/*
 * The names the permissions carry in Settings → Roles, so the no-access
 * message says the words an administrator will be looking for. Kept here
 * rather than read from org_permissions on every refusal; a key missing from
 * this list falls back to the key itself, which is still findable.
 */
const PERMISSION_NAMES: Partial<Record<Permission, string>> = {
  "clients.health": "View client health",
  "clients.results": "View client results",
  "finance.collections": "Run collections",
  "scoreboard.view": "View scoreboards",
  "talent.view": "View talent",
  "timelines.view": "View opportunity timelines",
};

/** What the person would need, for the NoAccess message. */
export function needFor(report: AnyReport): string {
  const names = report.permissions
    .map((p) => PERMISSION_NAMES[p] ?? p)
    // talent.recruit and talent.admin imply talent.view; naming all three
    // makes the message longer without making it more useful.
    .filter((name, i, all) => all.indexOf(name) === i)
    .slice(0, 2);
  return names.join(" or ") || "a signed-in Factur account";
}
