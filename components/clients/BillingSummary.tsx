import type { BillingSummary as Summary } from "@/actions/billing";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/**
 * One figure. Anything overdue is coloured, and it darkens with age, so the
 * row can be read without reading the numbers.
 */
function Tile({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "bad";
}) {
  const colour =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "";

  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${colour}`}>
        {value}
      </div>
    </div>
  );
}

export function BillingSummary({ summary }: { summary: Summary }) {
  const overdue = (amount: number, tone: "warn" | "bad") =>
    amount > 0 ? tone : undefined;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Tile label="Payment terms" value={summary.payment_terms ?? "—"} />
      <Tile label="Open balance" value={money.format(summary.open_balance)} />
      <Tile
        label="Past 30"
        value={money.format(summary.past_30)}
        tone={overdue(summary.past_30, "warn")}
      />
      <Tile
        label="Past 60"
        value={money.format(summary.past_60)}
        tone={overdue(summary.past_60, "warn")}
      />
      <Tile
        label="Past 90"
        value={money.format(summary.past_90)}
        tone={overdue(summary.past_90, "bad")}
      />
    </div>
  );
}
