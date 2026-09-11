/**
 * The exact criteria behind a board: which records are counted, how they are
 * bucketed, what is excluded. It matters when someone disputes a number, and
 * is noise the rest of the time -- so it is collapsed behind a heading rather
 * than filling the page below every board.
 */
export function FilterNote({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-8 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
      <summary className="cursor-pointer select-none list-none font-medium text-muted-foreground hover:text-foreground">
        <span className="inline-block transition-transform [details[open]_&]:rotate-90">▸</span>{" "}
        Data Criteria
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
