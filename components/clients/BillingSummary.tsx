import type { BillingSummary as Summary } from "@/actions/billing";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/**
 * One figure. Anything overdue is coloured, and the oldest slice is red, so the
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

/**
 * The ageing buckets in the report's own order and wording, so the row and the
 * A/R Ageing Summary can be read side by side.
 */
export function BillingSummary({ summary }: { summary: Summary }) {
  const overdue = (amount: number, tone: "warn" | "bad") =>
    amount > 0 ? tone : undefined;

  const hasCredits = Number(summary.credits) > 0;

  const buckets: { label: string; amount: number; tone: "warn" | "bad" }[] = [
    { label: "1 – 30", amount: summary.bucket_1_30, tone: "warn" },
    { label: "31 – 60", amount: summary.bucket_31_60, tone: "warn" },
    { label: "61 – 90", amount: summary.bucket_61_90, tone: "warn" },
    { label: "91 and over", amount: summary.bucket_91_plus, tone: "bad" },
  ];

  return (
    <div className="space-y-2">
      <div
        className={`grid grid-cols-2 gap-2 ${
          hasCredits ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-4"
        }`}
      >
        <Tile label="Payment terms" value={summary.payment_terms ?? "—"} />
        {/*
          * Owed and credits appear only where there is a credit to explain.
          * Everywhere else the open balance already is what they owe, and two
          * more tiles saying so teaches nobody anything.
          */}
        {hasCredits && <Tile label="Owed" value={money.format(summary.owed)} />}
        {hasCredits && (
          <Tile label="Credits" value={`−${money.format(summary.credits)}`} />
        )}
        <Tile label="Open balance" value={money.format(summary.open_balance)} />
        <Tile
          label="Avg days to pay"
          value={
            summary.avg_days_to_pay === null
              ? "—"
              : String(Math.round(summary.avg_days_to_pay))
          }
        />
        <Tile label="Invoices paid" value={String(summary.invoices_paid)} />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Tile label="Current" value={money.format(summary.bucket_current)} />
        {buckets.map((b) => (
          <Tile
            key={b.label}
            label={b.label}
            value={money.format(b.amount)}
            tone={overdue(b.amount, b.tone)}
          />
        ))}
      </div>
    </div>
  );
}
