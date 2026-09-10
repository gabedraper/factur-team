import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The top of every page. One shape, so 110 pages stop inventing their own --
 * there were eight different title treatments before this existed.
 *
 * The typeface is not set here and should not be: `globals.css` applies
 * `font-heading tracking-tight` to every h1, so a page title is Montserrat
 * whether or not it comes through this component. Only the size lives here.
 */

type PageHeaderProps = {
  title: React.ReactNode;
  /**
   * One line saying what the page is for. Optional deliberately -- writing a
   * good one is better than filling the slot, and a vague description is
   * worse than none.
   */
  description?: React.ReactNode;
  /** Section name above the title. Worth it once a page is nested deep. */
  eyebrow?: React.ReactNode;
  /** Primary controls for the page, right-aligned on the title's line. */
  actions?: React.ReactNode;
  /**
   * How many records the page holds, shown beside the title. Twenty-eight
   * pages already carried one through the talent and pipeline kits, so it
   * belongs here rather than being rebuilt beside every title.
   */
  count?: number | string;
  className?: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  count,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-meta uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        {/* 24px. h1 rather than a styled div so the page has one real
            document heading -- screen readers and the browser's own outline
            both depend on it. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {count !== undefined && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-meta tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {description ? (
          <p className="mt-1 max-w-prose text-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
