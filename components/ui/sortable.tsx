"use client";

import { useMemo, useState } from "react";
import { sortRows, nextSort, type SortDir, type SortValue } from "@/lib/sort";

export type { SortDir, SortValue };
export type Sort<K extends string> = { key: K; dir: SortDir } | null;

/**
 * Click-to-sort for a table whose rows are already in memory.
 *
 * Pass one accessor per sortable column. Clicking a header cycles ascending ->
 * descending -> off, and "off" restores whatever order the caller supplied --
 * which on several of these screens is meaningful in itself (people needing
 * review first, leads worst-first), so it is worth being able to get back to.
 */
export function useSort<T, K extends string>(
  rows: T[],
  columns: Record<K, (row: T) => SortValue>,
  initial: Sort<K> = null
) {
  const [sort, setSort] = useState<Sort<K>>(initial);

  // `columns` is typically an inline object, so this re-runs on each render.
  // At these row counts that is far cheaper than the machinery to avoid it.
  const sorted = useMemo(
    () => (sort ? sortRows(rows, columns[sort.key], sort.dir) : rows),
    [rows, columns, sort]
  );

  function toggle(key: K) {
    setSort((s) => nextSort(s, key));
  }

  /** Spread onto a SortHeader: `<SortHeader {...sortProps("name")}>Person</SortHeader>` */
  const sortProps = (key: K) => ({
    dir: sort?.key === key ? sort.dir : null,
    onSort: () => toggle(key),
  });

  return { sorted, sort, setSort, toggle, sortProps };
}

/**
 * A `<th>` that sorts. The arrow is always in the layout and only changes
 * opacity, so headers do not jump sideways as the sort moves between columns.
 */
export function SortHeader({
  dir,
  onSort,
  children,
  className = "",
  align = "left",
}: {
  dir: SortDir | null;
  onSort: () => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
}) {
  const justify =
    align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";

  return (
    <th
      className={className}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={onSort}
        title="Sort by this column"
        className={`group flex w-full items-center gap-1 ${justify} font-medium hover:text-foreground`}
      >
        <span>{children}</span>
        <span
          aria-hidden
          className={`text-[0.65em] leading-none transition-opacity ${
            dir ? "opacity-100" : "opacity-0 group-hover:opacity-40"
          }`}
        >
          {dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}
