import { ExternalLink } from "lucide-react";
import type { WorkItem } from "@/lib/work";
import { dueClass, shortDate, isOpen } from "@/lib/work";

/**
 * A mirrored task, as one line.
 *
 * The whole row is the link out, because there is nothing to open on this side
 * -- the mirror is read-only and the real task is in ClickUp. Making the title
 * the only target would leave most of the row inert and every click a near miss.
 */
function Row({
  item, show,
}: {
  item: WorkItem;
  /** Columns that are not implied by where the row is being rendered. */
  show?: { client?: boolean; process?: boolean };
}) {
  const open = isOpen(item);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="group flex items-baseline gap-3 border-b px-1 py-1.5 last:border-0 hover:bg-accent/50"
    >
      <span className="min-w-0 flex-1 truncate text-sm">
        {item.title}
        <ExternalLink className="ml-1.5 inline h-3 w-3 shrink-0 align-baseline text-muted-foreground opacity-0 group-hover:opacity-100" />
      </span>

      {show?.client && item.clientName && (
        <span className="hidden w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">
          {item.clientName}
        </span>
      )}

      {show?.process && item.processName && (
        <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground md:block">
          {item.processName}
          {item.pod ? ` · ${item.pod}` : ""}
        </span>
      )}

      <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground lg:block">
        {item.assignees.join(", ")}
      </span>

      <span className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground">
        {item.status}
      </span>

      <span className={`w-14 shrink-0 text-right text-xs tabular-nums ${dueClass(item.dueAt, open)}`}>
        {shortDate(item.dueAt)}
      </span>
    </a>
  );
}

export function WorkRows({
  items, show,
}: {
  items: WorkItem[];
  show?: { client?: boolean; process?: boolean };
}) {
  return (
    <div>
      {items.map((item) => (
        <Row key={item.id} item={item} show={show} />
      ))}
    </div>
  );
}
