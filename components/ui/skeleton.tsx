import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders.
 *
 * The chosen pattern is skeleton-then-content: hold the shape of the page
 * while data loads, then swap. It is the most work of the motion options --
 * every slow view needs a skeleton written for it -- which is why the rollout
 * is deliberate rather than universal. Pages fast enough not to flash a
 * loading state should not have one; a skeleton that appears for 80ms is worse
 * than nothing.
 *
 * The animation is a plain opacity pulse, not the diagonal shimmer that got
 * fashionable. A shimmer moves, so on a page with several of them the eye is
 * pulled between competing animations while it is trying to read nothing.
 *
 * Nothing here announces itself to assistive technology. A screen reader
 * should hear the real content when it arrives, not a description of grey
 * boxes -- so these are hidden, and the container that swaps them should carry
 * aria-busy instead.
 */

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-sm bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A table-shaped skeleton. Takes the row and column count so the placeholder
 * is the same height as the real thing and the page does not jump when data
 * lands -- which is the entire point of a skeleton over a spinner.
 */
export function TableSkeleton({
  rows = 8,
  cols = 4,
  identity = true,
}: {
  rows?: number;
  cols?: number;
  /** Leaves room for the thumbnail in the first column, as lists have. */
  identity?: boolean;
}) {
  /* Widths vary per column and per row so the block reads as text rather than
     as a grid of identical bars. Deterministic, not random: a skeleton that
     reshuffles on every render flickers during React's re-renders. */
  const width = (row: number, col: number) => {
    const scale = [72, 54, 63, 48, 68, 58];
    return `${scale[(row + col * 2) % scale.length]}%`;
  };

  return (
    <div className="w-full" aria-busy="true">
      <div className="flex border-b">
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="flex-1 px-cell-x py-cell-y">
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex border-b last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1 px-cell-x py-cell-y">
              {identity && c === 0 ? (
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-6 w-6 shrink-0 rounded-md" />
                  <Skeleton className="h-3.5 flex-1" style={{ maxWidth: width(r, c) }} />
                </div>
              ) : (
                <Skeleton className="h-3.5" style={{ width: width(r, c) }} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A Surface-shaped skeleton, for a page of stat panels. */
export function SurfaceSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-md bg-card p-card" aria-busy="true">
      <Skeleton className="mb-3 h-3.5 w-32" />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${[88, 64, 76][i % 3]}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * A list page, whole: title, the row of view chips, then the table. For a
 * route's loading.tsx, which Next shows the moment a link is clicked and swaps
 * for the page when it has rendered -- so it matches the list shell's spacing
 * exactly, or the page visibly lurches when the real one lands.
 */
export function PageSkeleton({
  rows = 10,
  cols = 5,
  identity = false,
  chips = true,
  stats = 0,
}: {
  rows?: number;
  cols?: number;
  /** Company lists carry a logo in the first column; people lists do not. */
  identity?: boolean;
  /** The view chip row. Leave off on pages that have no saved views. */
  chips?: boolean;
  /** Figure tiles above the table, for pages that lead with totals. */
  stats?: number;
}) {
  return (
    <div className="space-y-4 p-section" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      {chips && (
        <div className="flex gap-1.5">
          {[20, 28, 24, 32].map((w, i) => (
            <Skeleton key={i} className="h-7 rounded-md" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
      )}
      {stats > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-md bg-card p-card-tight">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-md bg-card">
        <TableSkeleton rows={rows} cols={cols} identity={identity} />
      </div>
    </div>
  );
}
