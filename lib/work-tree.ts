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
