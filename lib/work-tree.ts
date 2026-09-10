/**
 * The ClickUp tree, as this app understands it.
 *
 * Types and labels only, so actions/work-tree.ts can stay "use server".
 */

export type ContainerKind = "space" | "folder" | "list";

export type Container = {
  id: string;
  clickupId: string;
  kind: ContainerKind;
  name: string;
  /** What ClickUp reports for a list, or the sum beneath a folder. */
  taskCount: number;
  /** Open items in our mirror. Null where we have not mirrored this list. */
  openCount: number | null;
  url: string | null;
};

export type Crumb = { clickupId: string; name: string; kind: ContainerKind };

export const KIND_LABEL: Record<ContainerKind, string> = {
  space: "Space",
  folder: "Folder",
  list: "List",
};

/** One resolved custom field value, as the sync stored it. */
export type FieldValue = {
  id: string;
  name: string;
  type: string;
  display: string;
};

export type Dependency = {
  clickupId: string;
  relation: "blocking" | "waiting_on";
  /** Null when the other end has not been mirrored. */
  title: string | null;
};

/** A task as a list view needs it: everything a row can show. */
export type ListItem = {
  id: string;
  clickupId: string;
  url: string;
  title: string;
  status: string;
  statusType: "open" | "custom" | "done" | "closed" | null;
  priority: string | null;
  startAt: string | null;
  dueAt: string | null;
  timeEstimateMs: number | null;
  assignees: string[];
  fields: FieldValue[];
  dependencies: Dependency[];
  parentClickupId: string | null;
  clientName: string | null;
  clientId: string | null;
};

/** ClickUp writes estimates in milliseconds and shows them as 10m / 7h. */
export function estimate(ms: number | null): string {
  if (!ms || ms <= 0) return "";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = mins / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/**
 * Fields worth their own column.
 *
 * A task carries sixteen field definitions and typically three values, and a
 * row cannot be sixteen columns wide. The ones most rows actually fill are the
 * ones the list is really about; the grouping field is excluded because it is
 * already the heading above every row.
 */
export function columnFields(items: ListItem[], groupBy: string, max = 3): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const f of item.fields) {
      if (f.name === groupBy) continue;
      counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= Math.max(2, items.length * 0.2))
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name]) => name);
}

/** Grouping choices: status, plus any single-select field the list uses. */
export function groupOptions(items: ListItem[]): string[] {
  const seen = new Map<string, number>();
  for (const item of items) {
    for (const f of item.fields) {
      if (f.type !== "drop_down" && f.type !== "labels") continue;
      seen.set(f.name, (seen.get(f.name) ?? 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}
