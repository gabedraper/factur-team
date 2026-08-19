export const DEAL_PERIODS = ["this_month", "last_month", "this_year", "last_year"] as const;
export type DealPeriod = (typeof DEAL_PERIODS)[number];

export const DEAL_PERIOD_LABEL: Record<DealPeriod, string> = {
  this_month: "This Month",
  last_month: "Last Month",
  this_year: "This Year",
  last_year: "Last Year",
};

export function isDealPeriod(value: unknown): value is DealPeriod {
  return typeof value === "string" && (DEAL_PERIODS as readonly string[]).includes(value);
}

export const RETENTION_PERIODS = ["all_time", "this_year", "last_year"] as const;
export type RetentionPeriod = (typeof RETENTION_PERIODS)[number];

export const RETENTION_PERIOD_LABEL: Record<RetentionPeriod, string> = {
  all_time: "All Time",
  this_year: "This Year",
  last_year: "Last Year",
};

export function isRetentionPeriod(value: unknown): value is RetentionPeriod {
  return typeof value === "string" && (RETENTION_PERIODS as readonly string[]).includes(value);
}

export function retentionPeriodRange(period: RetentionPeriod) {
  if (period === "all_time") {
    return { start: "2000-01-01", end: "2999-12-31" };
  }
  const now = new Date();
  const y = period === "this_year" ? now.getFullYear() : now.getFullYear() - 1;
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function dealPeriodRange(period: DealPeriod) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  let start: Date;
  let end: Date;
  switch (period) {
    case "this_month":
      start = new Date(y, m, 1);
      end = new Date(y, m + 1, 0);
      break;
    case "last_month":
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 0);
      break;
    case "this_year":
      start = new Date(y, 0, 1);
      end = new Date(y, 11, 31);
      break;
    case "last_year":
      start = new Date(y - 1, 0, 1);
      end = new Date(y - 1, 11, 31);
      break;
  }

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
