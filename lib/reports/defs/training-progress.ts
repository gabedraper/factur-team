import { getProgressReport } from "@/actions/progress-report";
import type { Report } from "../types";

type Row = Awaited<ReturnType<typeof getProgressReport>>["users"][number];

const nf = new Intl.NumberFormat("en-US");

/**
 * Training progress, person by person. Company-wide like the scoreboards --
 * /progress has no gate either -- so no permission is named.
 *
 * Someone with no courses assigned has no progress to report, only an
 * absence of assignments, so they are left out of the averages and the
 * progress-state filter but kept in the list.
 */
export const trainingProgress: Report<Row> = {
  key: "training-progress",
  label: "Training progress",
  description: "Where every person stands on the courses their role assigns them.",
  group: "Training",
  noun: "people",
  permissions: [],
  params: [
    {
      key: "state",
      label: "Progress",
      type: "picklist",
      options: [
        { value: "complete", label: "Fully complete" },
        { value: "started", label: "In progress" },
        { value: "none", label: "Not started" },
      ],
    },
  ],
  search: (r) => `${r.name} ${r.roleLabel} ${r.email}`,
  columns: [
    // A people list: the name is the whole cell, no avatar.
    { key: "name", label: "Person", type: "text", read: (r) => r.name, href: (r) => `/progress/person/${r.id}` },
    { key: "role", label: "Role", type: "text", read: (r) => r.roleLabel, muted: true },
    { key: "courses", label: "Courses assigned", type: "number", read: (r) => r.totalCourses, total: "sum" },
    { key: "completed", label: "Completed", type: "number", read: (r) => r.completedCourses, total: "sum" },
    {
      key: "progress", label: "Overall", type: "percent",
      read: (r) => (r.totalCourses > 0 ? r.overallProgress : null),
      total: "avg",
    },
  ],
  rowKey: (r) => r.id,
  defaultSort: { key: "progress", dir: "desc" },
  run: async () => (await getProgressReport()).users,
  filter: (r, v) => {
    if (!v.state) return true;
    if (r.totalCourses === 0) return false;
    if (v.state === "complete") return r.completedCourses === r.totalCourses;
    if (v.state === "none") return r.overallProgress === 0;
    return r.overallProgress > 0 && r.completedCourses < r.totalCourses;
  },
  stats: (rows) => {
    const assigned = rows.filter((r) => r.totalCourses > 0);
    const avg = assigned.length
      ? Math.round(assigned.reduce((s, r) => s + r.overallProgress, 0) / assigned.length)
      : 0;
    return [
      { label: "People", value: nf.format(rows.length) },
      { label: "Average completion", value: `${avg}%` },
      { label: "Fully complete", value: nf.format(assigned.filter((r) => r.completedCourses === r.totalCourses).length) },
      { label: "Not started", value: nf.format(assigned.filter((r) => r.overallProgress === 0).length) },
    ];
  },
};
