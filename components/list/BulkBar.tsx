"use client";

import { cn } from "@/lib/utils";

/**
 * The bar that appears once rows are selected.
 *
 * Bulk selection is the app's primary way of acting on records, because that
 * is how the work actually happens — adding forty contacts to a sequence,
 * exporting a filtered set. Single-record actions are not repeated down every
 * row; clicking a row opens the record, and the actions live there.
 *
 * The bar replaces the header rather than floating over the rows. A floating
 * bar covers the bottom of the list, which is where you are still selecting.
 */

export function BulkBar({
  count,
  noun,
  onClear,
  children,
  className,
}: {
  count: number;
  /** Singular. Pluralised here so callers cannot disagree about it. */
  noun: string;
  onClear: () => void;
  /** The actions. Destructive ones last, and never first. */
  children: React.ReactNode;
  className?: string;
}) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label={`${count} selected`}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md bg-primary px-3 py-2 text-primary-foreground",
        className,
      )}
    >
      <span className="text-body font-medium tabular-nums">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>

      <button
        type="button"
        onClick={onClear}
        className="rounded-sm px-2 py-1 text-meta underline-offset-2 hover:underline"
      >
        Clear
      </button>
    </div>
  );
}

/** An action inside the bar. Kept quiet so the count stays the loud thing. */
export function BulkAction({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm px-2.5 py-1 text-body transition-colors duration-fast ease-out",
        danger
          ? "text-primary-foreground/80 hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-primary-foreground/15",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The header checkbox.
 *
 * Indeterminate is set through a ref because it is a DOM property with no HTML
 * attribute — writing `indeterminate={true}` in JSX silently does nothing, and
 * the box then reads as "none selected" while half the page is ticked.
 */
export function SelectAllBox({
  checked,
  indeterminate,
  onChange,
  label = "Select all rows",
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--primary))]"
    />
  );
}
