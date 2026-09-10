"use client";

import { cn } from "@/lib/utils";
import {
  humanize, KIND_LABELS,
  type ColumnMeta, type FieldRef, type Kind, type ObjectMeta,
} from "@/lib/reporting/spec";

/**
 * Small pieces the builder is assembled from. Native form controls
 * throughout: a select posts, works with a keyboard, and does not need a
 * popover library to be right.
 */

/* The Input's recipe at the builder's height, shared by every select here. */
export const FIELD =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-field px-2.5 text-sm ring-offset-background " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function Labelled({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-meta font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Two or three choices that behave like radio buttons. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-sm px-3 py-1 text-body transition-colors duration-fast ease-out",
            value === o.value
              ? "bg-card text-foreground shadow-raised"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A quiet remove button for a row in a list. */
export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-9 shrink-0 rounded-md px-2 text-meta text-muted-foreground transition-colors duration-fast ease-out hover:bg-card-hover hover:text-foreground"
    >
      ×
    </button>
  );
}

// ---------------------------------------------------------------------------
// Field references
// ---------------------------------------------------------------------------

/** "client_id" or "client_id|name" -- how a FieldSelect encodes its value. */
export function encodeRef(ref: FieldRef): string {
  return ref.lookup ? `${ref.field}|${ref.lookup}` : ref.field;
}

export function decodeRef(value: string): FieldRef {
  const [field, lookup] = value.split("|");
  return lookup ? { field, lookup } : { field };
}

export function refLabel(ref: FieldRef): string {
  return ref.lookup ? `${humanize(ref.field)} › ${humanize(ref.lookup)}` : humanize(ref.field);
}

/** The kind of a field reference, looked up through the catalogue. */
export function kindOf(
  ref: FieldRef,
  object: ObjectMeta | null,
  byName: Map<string, ObjectMeta>,
): Kind | null {
  const col = object?.columns.find((c) => c.name === ref.field);
  if (!col) return null;
  if (!ref.lookup) return col.kind;
  const target = col.lookup ? byName.get(col.lookup.table) : null;
  return target?.columns.find((c) => c.name === ref.lookup)?.kind ?? null;
}

/**
 * A select over one object's fields, with each foreign key opened into the
 * fields of the table it points at -- so "Client › Name" is one choice
 * rather than a join anybody has to think about.
 */
export function FieldSelect({
  object,
  byName,
  value,
  onChange,
  placeholder = "Choose a field",
  only,
  className,
}: {
  object: ObjectMeta;
  byName: Map<string, ObjectMeta>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Restrict to these kinds -- numbers for a sum, dates for a period. */
  only?: Kind[];
  className?: string;
}) {
  const allowed = (c: ColumnMeta) => !only || only.includes(c.kind);
  const base = object.columns.filter(allowed);
  const lookups = object.columns.filter((c) => c.lookup && byName.has(c.lookup.table));

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(FIELD, className)}>
      <option value="">{placeholder}</option>
      {base.map((c) => (
        <option key={c.name} value={c.name}>
          {humanize(c.name)} · {KIND_LABELS[c.kind]}
        </option>
      ))}
      {lookups.map((c) => {
        const target = byName.get(c.lookup!.table)!;
        const cols = target.columns.filter((tc) => allowed(tc) && tc.kind !== "json");
        if (cols.length === 0) return null;
        return (
          <optgroup key={c.name} label={`${humanize(c.name)} (${target.name})`}>
            {cols.map((tc) => (
              <option key={tc.name} value={`${c.name}|${tc.name}`}>
                {humanize(c.name)} › {humanize(tc.name)} · {KIND_LABELS[tc.kind]}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/** The columns a fresh report starts with: the first few that read as words, not ids. */
export function starterColumns(object: ObjectMeta): FieldRef[] {
  const picked: FieldRef[] = [];
  for (const c of object.columns) {
    if (picked.length >= 6) break;
    if (c.kind === "json" || c.kind === "array") continue;
    if (c.kind === "uuid") {
      if (c.lookup?.label) picked.push({ field: c.name, lookup: c.lookup.label });
      continue;
    }
    picked.push({ field: c.name });
  }
  return picked;
}
