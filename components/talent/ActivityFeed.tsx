import { Pin } from "lucide-react";
import { Chip, Dot, Empty } from "@/components/talent/bits";
import { ago, onDayTime } from "@/lib/talent/format";
import type { Activity, ActivityType } from "@/lib/talent/types";

type Row = Activity & { tal_activity_types: ActivityType | null };

/**
 * One timeline, whatever it is hanging off.
 *
 * Pinned entries sit at the top -- that is what pinning is for -- and the rest
 * run newest first. The body is rendered as plain text with line breaks
 * preserved rather than as HTML: a note can contain anything somebody pasted
 * out of an email, and none of it should be able to run.
 */
export function ActivityFeed({
  activities, authors, emptyText = "Nothing logged yet",
}: {
  activities: Row[];
  authors: Map<string, string>;
  emptyText?: string;
}) {
  if (!activities.length) return <Empty>{emptyText}</Empty>;

  return (
    <ol className="divide-y">
      {activities.map((a) => {
        const type = a.tal_activity_types;
        return (
          <li key={a.id} className="flex gap-3 px-4 py-3">
            <span className="mt-2"><Dot colour={type?.color} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Chip colour={type?.color}>{type?.name ?? "Activity"}</Chip>
                {a.subject && <span className="text-sm font-medium">{a.subject}</span>}
                {a.direction && (
                  <span className="text-xs text-muted-foreground">
                    {a.direction === "inbound" ? "in" : "out"}
                  </span>
                )}
                {a.pinned && <Pin className="h-3 w-3 text-amber-500" aria-label="Pinned" />}
                <span
                  className="ml-auto text-xs text-muted-foreground"
                  title={onDayTime(a.occurred_at)}
                >
                  {ago(a.occurred_at)}
                </span>
              </div>

              {a.body && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              )}

              <p className="mt-1 text-xs text-muted-foreground">
                {a.created_by ? authors.get(a.created_by) ?? "Someone" : "System"}
                {a.outcome ? ` · ${a.outcome}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
