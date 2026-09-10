import { activityReport } from "@/lib/talent/queries";
import { isoDaysAgo, today } from "../params";
import type { Report } from "../types";

type Row = Awaited<ReturnType<typeof activityReport>>[number];

/**
 * What the recruiting team did over a period, from `tal_activity_report`.
 * The same numbers as the Activity panel on /talent/reports, which is hidden
 * from the menu; this is the place to read them now.
 */
export const talentActivity: Report<Row> = {
  key: "talent-activity",
  label: "Recruiting activity",
  description: "Calls, emails, meetings, notes, submissions and placements per person over a period.",
  group: "Talent",
  noun: "people",
  permissions: ["talent.view", "talent.recruit", "talent.admin"],
  params: [
    { key: "from", label: "From", type: "date", default: () => isoDaysAgo(30) },
    { key: "to", label: "To", type: "date", default: today },
  ],
  search: (r) => r.member_name ?? "",
  columns: [
    { key: "person", label: "Person", type: "text", read: (r) => r.member_name },
    { key: "calls", label: "Calls", type: "number", read: (r) => r.calls, total: "sum" },
    { key: "emails", label: "Emails", type: "number", read: (r) => r.emails, total: "sum" },
    { key: "meetings", label: "Meetings", type: "number", read: (r) => r.meetings, total: "sum" },
    { key: "notes", label: "Notes", type: "number", read: (r) => r.notes, total: "sum" },
    { key: "submissions", label: "Submissions", type: "number", read: (r) => r.submissions, total: "sum" },
    { key: "placements", label: "Placements", type: "number", read: (r) => r.placements, total: "sum" },
    { key: "total", label: "Total", type: "number", read: (r) => r.total, total: "sum" },
  ],
  rowKey: (r) => r.member_id,
  defaultSort: { key: "total", dir: "desc" },
  run: (v) => activityReport(v.from, v.to),
};
