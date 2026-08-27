"use client";

import { HISTORY_FIELD_LABEL, type HistorySpan } from "@/lib/client-history";

/**
 * Who has been on this client, and who is on it now.
 *
 * Grouped by role rather than listed as one stream of changes: the question
 * people actually arrive with is "who looks after this account", and the
 * history is the answer to the follow-up. A role with no past reads as one
 * line, so a client that has never changed hands stays quiet.
 */
function when(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function HistoryPanel({ spans }: { spans: HistorySpan[] }) {
  if (spans.length === 0) {
    return <p className="text-sm text-muted-foreground">No history recorded yet.</p>;
  }

  const fields = Object.keys(HISTORY_FIELD_LABEL).filter((f) =>
    spans.some((s) => s.field === f)
  );

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        // Newest first, so the open span leads.
        const rows = spans
          .filter((s) => s.field === field)
          .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
        const [current, ...past] = rows;

        return (
          <div key={field} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 last:border-0">
            <span className="w-40 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
              {HISTORY_FIELD_LABEL[field]}
            </span>
            <span className="font-medium">
              {current.value ?? <span className="text-muted-foreground">vacant</span>}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              since {when(current.validFrom)}
            </span>

            {past.length > 0 && (
              <div className="w-full pl-40 text-xs text-muted-foreground">
                {past.map((p) => (
                  <div key={p.id} className="tabular-nums">
                    {p.value ?? "vacant"} · {when(p.validFrom)} to{" "}
                    {p.validTo ? when(p.validTo) : "—"}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
