import Link from "next/link";
import { Folder, List as ListIcon, Layers } from "lucide-react";
import type { Container } from "@/lib/work-tree";

const ICON = {
  space: Layers,
  folder: Folder,
  list: ListIcon,
};

/**
 * Spaces, folders and lists as rows.
 *
 * Two counts, because they answer different questions: what ClickUp says is in
 * there, and what is open in ours. They disagree wherever a list is mostly
 * finished work, which is most of them.
 */
export function ContainerRows({ items }: { items: Container[] }) {
  if (items.length === 0) {
    return <p className="px-1 py-3 text-sm text-muted-foreground">Empty.</p>;
  }

  return (
    <div>
      {items.map((c) => {
        const Icon = ICON[c.kind];
        return (
          <Link
            key={c.id}
            href={`/work/browse/${c.clickupId}`}
            className="flex items-baseline gap-3 border-b px-1 py-2 last:border-0 hover:bg-accent/50"
          >
            <Icon className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            {c.openCount !== null && c.openCount > 0 && (
              <span className="shrink-0 text-xs tabular-nums">{c.openCount} open</span>
            )}
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {c.taskCount || ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
