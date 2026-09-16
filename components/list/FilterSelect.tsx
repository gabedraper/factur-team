"use client";

import { control } from "@/components/ui/control";

/*
 * A dropdown in a filter row: a plain <select> inside a plain GET form, which
 * submits itself the moment it changes.
 *
 * The form is what makes the filter a query parameter rather than component
 * state, so the list survives a reload and the back button undoes a filter.
 * This adds only the convenience of not having to press a button -- with
 * JavaScript off the same form still posts from the submit button beside it,
 * which is why that button exists rather than being styled away.
 */
export function FilterSelect({
  name,
  label,
  value,
  options,
  any,
  anyValue = "",
  extra = [],
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
  /** What the "no filter" row says: "Any account manager". */
  any: string;
  anyValue?: string;
  extra?: { value: string; label: string }[];
}) {
  return (
    <select
      name={name}
      aria-label={label}
      defaultValue={value}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={control({ size: "sm" })}
    >
      <option value={anyValue}>{any}</option>
      {extra.map((e) => (
        <option key={e.value} value={e.value}>{e.label}</option>
      ))}
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
