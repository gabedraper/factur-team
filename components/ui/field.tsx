import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One form field: label above, control, then one line underneath. Chosen
 * 2026-09-10 -- a label above survives any width, reads fastest, and needs no
 * fixed label column.
 *
 * The line underneath is always there, and it is the whole trick. It holds the
 * hint, and when validation fires the error takes the hint's place, so the
 * form does not jump as messages come and go. Stack fields with `gap-2`; the
 * reserved line supplies the rest of the space between them.
 *
 * The label wraps the control rather than pointing at it with an id, so this
 * needs no hooks and works in server and client components alike. Radix
 * Select's trigger is a button, and a label click activates buttons too.
 */

type FieldProps = {
  label: React.ReactNode;
  /** Shown under the control until there is an error to show instead. */
  hint?: React.ReactNode;
  /** Replaces the hint. Pass the message, or nothing when the value is fine. */
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label className="grid min-w-0 gap-1.5">
        <span className="text-body font-medium leading-none">{label}</span>
        {children}
      </label>
      <FieldMessage hint={hint} error={error} />
    </div>
  );
}

/**
 * For a set of controls that answer one question -- radio buttons, a group of
 * checkboxes. A <label> can only wrap one control, so a set gets a fieldset
 * and a legend, which screen readers announce before each option.
 */
export function FieldSet({ label, hint, error, children, className }: FieldProps) {
  return (
    <fieldset className={cn("grid min-w-0 gap-1.5", className)}>
      <legend className="mb-1.5 text-body font-medium leading-none">{label}</legend>
      {children}
      <FieldMessage hint={hint} error={error} />
    </fieldset>
  );
}

function FieldMessage({ hint, error }: { hint?: React.ReactNode; error?: React.ReactNode }) {
  return (
    // min-h holds one line open whether or not there is anything to say.
    // aria-live so a screen reader hears the error when it appears.
    <p
      aria-live="polite"
      className={cn("min-h-4 text-meta", error ? "text-destructive" : "text-muted-foreground")}
    >
      {error || hint}
    </p>
  );
}
