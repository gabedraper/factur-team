import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Table the app never had. 47 files hand-rolled a `<table>` with their own
 * padding, their own header styling and their own alignment classes, which is
 * why horizontal padding was split 348 / 240 between two values.
 *
 * Density lives in exactly two tokens -- `cell-x` and `cell-y`. Change those
 * in tailwind.config.ts and every list in the app changes with them. Nothing
 * here hardcodes a pixel.
 *
 * The current setting is 10px vertical by 16px horizontal, chosen so a 24px
 * company logo fits a row without stretching it. That is the whole reason the
 * density is not tighter, so if logos ever leave the lists, revisit it.
 *
 * `<TableScroll>` is not optional decoration. A wide table inside a page that
 * cannot scroll sideways will push the entire layout wide, and the fix is
 * always the same wrapper -- so it ships with the component.
 */

export function TableScroll({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>{children}</div>
  );
}

export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn("w-full border-collapse text-body", className)}
    {...props}
  />
));
Table.displayName = "Table";

export const THead = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
THead.displayName = "THead";

export const TBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    /* Rows are separated by hairlines, and the last one is dropped so a table
       never draws a line against its container's edge. */
    className={cn("[&_tr:not(:last-child)]:border-b", className)}
    {...props}
  />
));
TBody.displayName = "TBody";

export const TR = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }
>(({ className, interactive, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      interactive &&
        "cursor-pointer transition-colors duration-fast ease-out hover:bg-card-hover",
      className,
    )}
    {...props}
  />
));
TR.displayName = "TR";

type CellProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  /**
   * Right-align. Use it for every money and count column -- a figure read
   * against a ragged left edge is measurably slower to compare.
   */
  numeric?: boolean;
};

export const TH = React.forwardRef<HTMLTableCellElement, CellProps>(
  ({ className, numeric, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "px-cell-x py-cell-y text-left text-meta font-medium text-muted-foreground",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  ),
);
TH.displayName = "TH";

export const TD = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-cell-x py-cell-y align-middle",
      /* tabular-nums makes digits equal width, so figures line up down a
         column instead of wandering. Free, and only correct on numbers. */
      numeric && "text-right tabular-nums",
      className,
    )}
    {...props}
  />
));
TD.displayName = "TD";

/**
 * The identity cell: logo or avatar, then the name, then optional secondary
 * text beneath. Every list that names a company or a person uses this, so the
 * thumbnail can never be forgotten on one screen and present on another.
 */
export function TDIdentity({
  thumb,
  name,
  sub,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  thumb: React.ReactNode;
  name: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    /* A width cap, because `truncate` does nothing in a table cell on its own:
       the column just grows to the longest name and pushes every column after
       it off the right edge. Capped, a long name gets its ellipsis. */
    <td className={cn("max-w-[22rem] px-cell-x py-cell-y align-middle", className)} {...props}>
      <div className="flex items-center gap-2.5">
        <span className="shrink-0">{thumb}</span>
        <span className="min-w-0">
          <span className="block truncate">{name}</span>
          {sub ? (
            <span className="block truncate text-meta text-muted-foreground">{sub}</span>
          ) : null}
        </span>
      </div>
    </td>
  );
}
