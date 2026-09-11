/**
 * One task, as its detail page needs it.
 *
 * Types only, so actions/work-detail.ts can stay "use server".
 */

export type Person = { name: string; initials: string; color: string | null };

export type RelatedTask = {
  clickupId: string;
  title: string;
  status: string | null;
  statusType: string | null;
};

export type CommentSegment =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string }
  | { kind: "mention"; text: string };

export type Comment = {
  id: string;
  author: Person;
  at: string;
  segments: CommentSegment[];
  replies: Comment[];
  replyCount: number;
};

export type TaskDetail = {
  clickupId: string;
  url: string;
  title: string;
  status: string;
  statusType: string | null;
  statusColor: string | null;
  priority: string | null;
  priorityColor: string | null;

  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  startAt: string | null;
  dueAt: string | null;

  timeEstimateMs: number | null;
  timeSpentMs: number | null;

  creator: Person | null;
  assignees: Person[];
  watchers: Person[];
  tags: { name: string; color: string | null }[];

  description: string;

  /** Every field defined on the task, set or not -- as ClickUp shows them. */
  fields: { name: string; display: string }[];

  checklists: { name: string; items: { name: string; resolved: boolean }[] }[];
  attachments: {
    title: string; url: string; thumbnail: string | null;
    extension: string | null; size: number | null; at: string | null;
  }[];

  parent: RelatedTask | null;
  subtasks: (RelatedTask & { assignees: string[]; dueAt: string | null })[];
  waitingOn: RelatedTask[];
  blocking: RelatedTask[];
  linked: RelatedTask[];
  /** Relations pointing at tasks the viewer may not see. Counted, never named. */
  hiddenRelations: number;

  comments: Comment[];

  path: {
    spaceId: string | null; space: string | null;
    folder: string | null;
    listId: string | null; list: string | null;
  };

  clientId: string | null;
  clientName: string | null;
  processName: string | null;

  /** When ClickUp was last asked, and whether that answer is old because it
   *  could not be asked again. */
  fetchedAt: string | null;
  stale: boolean;
};

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}
