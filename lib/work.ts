/**
 * The shape of a mirrored ClickUp task, apart from the actions that read it.
 *
 * Its own file for the same reason as lib/client-history.ts: a "use server"
 * module may only export async functions, and these are types and constants.
 */

export type WorkItem = {
  id: string;
  clickupId: string;
  url: string;
  title: string;
  status: string;
  /** ClickUp's own grouping. The status *names* differ per list; this does not. */
  statusType: "open" | "custom" | "done" | "closed" | null;
  priority: "urgent" | "high" | "normal" | "low" | null;
  dueAt: string | null;
  processName: string | null;
  processSlug: string | null;
  pod: string | null;
  clientId: string | null;
  clientName: string | null;
  space: string | null;
  folder: string | null;
  list: string | null;
  assignees: string[];
};

export type WorkGroup = {
  slug: string;
  name: string;
  items: WorkItem[];
};

export type SyncState = {
  finishedAt: string | null;
  itemsWritten: number;
  unmatched: number;
  error: string | null;
};

/** Open in ClickUp's sense: not done, not closed. */
export function isOpen(item: WorkItem): boolean {
  return item.statusType === "open" || item.statusType === "custom";
}

export const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0, high: 1, normal: 2, low: 3,
};

/*
 * Overdue is worth its own colour and nothing else is. ClickUp shows five
 * priority colours and a due-date colour on every row, which makes a busy list
 * unreadable -- the eye has nothing to land on. One signal, one colour.
 */
export function dueClass(dueAt: string | null, open: boolean): string {
  if (!dueAt || !open) return "text-muted-foreground";
  return new Date(dueAt) < new Date() ? "text-destructive" : "text-muted-foreground";
}

export function shortDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
