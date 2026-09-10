"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, ChevronRight, ChevronDown } from "lucide-react";
import type { ListItem } from "@/lib/work-tree";
import { estimate, columnFields, groupOptions } from "@/lib/work-tree";
import { dueClass, shortDate } from "@/lib/work";

/**
 * A ClickUp list, rebuilt read-only.
 *
 * Laid out the way the real one is, because the point is that somebody who
 * lives in that page can read this one without being taught it: grouped with a
 * count per group, subtasks indented under their parent, and the same columns
 * -- status, who, the fields this list actually uses, dates, estimate, what it
 * is waiting on.
 *
 * Nothing here edits. Every title is a link out to the task in ClickUp.
 */
export function ListView({ items }: { items: ListItem[] }) {
  const groups = useMemo(() => groupOptions(items), [items]);
  const [groupBy, setGroupBy] = useState<string>(groups[0] ?? "Status");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const columns = useMemo(() => columnFields(items, groupBy), [items, groupBy]);

  /* Subtasks hang under their parent when the parent is in this list, and
   * stand on their own when it is not -- a list filtered to a phase can hold a
   * child whose parent lives elsewhere. */
  const { roots, childrenOf } = useMemo(() => {
    const present = new Set(items.map((i) => i.clickupId));
    const childrenOf = new Map<string, ListItem[]>();
    const roots: ListItem[] = [];
    for (const item of items) {
      const parent = item.parentClickupId;
      if (parent && present.has(parent)) {
        childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), item]);
      } else {
        roots.push(item);
      }
    }
    return { roots, childrenOf };
  }, [items]);

  const keyFor = (item: ListItem) =>
    groupBy === "Status"
      ? item.status
      : item.fields.find((f) => f.name === groupBy)?.display ?? "—";

  const grouped = useMemo(() => {
    const map = new Map<string, ListItem[]>();
    for (const item of roots) {
      const k = keyFor(item);
      map.set(k, [...(map.get(k) ?? []), item]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [roots, groupBy]);

  function toggle(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function Row({ item, depth }: { item: ListItem; depth: number }) {
    const kids = childrenOf.get(item.clickupId) ?? [];
    const waiting = item.dependencies.filter((d) => d.relation === "waiting_on");

    return (
      <>
        <tr className="group border-b last:border-0 hover:bg-accent/50">
          <td className="py-1.5 pr-3" style={{ paddingLeft: `${depth * 20 + 4}px` }}>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm hover:underline"
            >
              {item.title}
              <ExternalLink className="ml-1.5 inline h-3 w-3 align-baseline text-muted-foreground opacity-0 group-hover:opacity-100" />
            </a>
          </td>
          <td className="whitespace-nowrap px-3 text-xs uppercase tracking-wide text-muted-foreground">
            {item.status}
          </td>
          <td className="max-w-[10rem] truncate px-3 text-xs text-muted-foreground">
            {item.assignees.join(", ")}
          </td>
          {columns.map((name) => (
            <td key={name} className="max-w-[10rem] truncate px-3 text-xs text-muted-foreground">
              {item.fields.find((f) => f.name === name)?.display ?? ""}
            </td>
          ))}
          <td className="whitespace-nowrap px-3 text-right text-xs tabular-nums text-muted-foreground">
            {shortDate(item.startAt)}
          </td>
          <td className={`whitespace-nowrap px-3 text-right text-xs tabular-nums ${dueClass(item.dueAt, item.statusType !== "done" && item.statusType !== "closed")}`}>
            {shortDate(item.dueAt)}
          </td>
          <td className="whitespace-nowrap px-3 text-right text-xs tabular-nums text-muted-foreground">
            {estimate(item.timeEstimateMs)}
          </td>
          <td className="max-w-[12rem] truncate px-3 text-xs text-muted-foreground">
            {waiting.map((d) => d.title ?? d.clickupId).join(", ")}
          </td>
        </tr>
        {kids.map((kid) => (
          <Row key={kid.id} item={kid} depth={depth + 1} />
        ))}
      </>
    );
  }

  const colCount = 7 + columns.length;

  return (
    <div className="space-y-3">
      {groups.length > 0 && (
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          <option value="Status">Status</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[52rem]">
          <thead>
            <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pl-1 pr-3 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Assignee</th>
              {columns.map((name) => (
                <th key={name} className="px-3 py-2 font-medium">{name}</th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Start</th>
              <th className="px-3 py-2 text-right font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Est.</th>
              <th className="px-3 py-2 font-medium">Waiting on</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([name, rows]) => (
              <>
                <tr key={`h-${name}`} className="border-b bg-muted/40">
                  <td colSpan={colCount} className="px-1 py-1.5">
                    <button
                      onClick={() => toggle(name)}
                      className="inline-flex items-center gap-1 text-xs font-semibold"
                    >
                      {collapsed.has(name) ? (
                        <ChevronRight className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      {name}
                      <span className="ml-1 font-normal tabular-nums text-muted-foreground">
                        {rows.length}
                      </span>
                    </button>
                  </td>
                </tr>
                {!collapsed.has(name) &&
                  rows.map((item) => <Row key={item.id} item={item} depth={0} />)}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
