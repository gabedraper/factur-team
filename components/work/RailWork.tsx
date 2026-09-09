"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { WorkItem } from "@/lib/work";
import { dueClass, shortDate, isOpen } from "@/lib/work";
import { appDestination } from "@/lib/work-anchor";

/**
 * Your open ClickUp work, in the right rail, on every page.
 *
 * The rail's own note said tasks belong here as their own section, and it is
 * right: what you owe people is not a page you navigate to, it is the thing you
 * keep glancing at. Narrow, so it carries the title, where it belongs and when
 * it is due, and nothing else.
 */
export function RailWork({ items, collapsed }: { items: WorkItem[]; collapsed: boolean }) {
  if (collapsed || items.length === 0) return null;

  return (
    <div className="p-3">
      {items.slice(0, 12).map((item) => {
        const destination = appDestination(item);
        return (
          <div key={item.id} className="group border-b py-1.5 last:border-0">
            <div className="flex items-baseline gap-2">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-xs hover:underline"
              >
                {item.title}
                <ExternalLink className="ml-1 inline h-2.5 w-2.5 align-baseline text-muted-foreground opacity-0 group-hover:opacity-100" />
              </a>
              <span className={`shrink-0 text-[10px] tabular-nums ${dueClass(item.dueAt, isOpen(item))}`}>
                {shortDate(item.dueAt)}
              </span>
            </div>
            {destination && (
              <Link
                href={destination.href}
                className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {destination.label}
              </Link>
            )}
          </div>
        );
      })}

      {items.length > 12 && (
        <Link href="/work" className="mt-2 block text-[10px] text-muted-foreground hover:text-foreground">
          {items.length - 12} more
        </Link>
      )}
    </div>
  );
}
