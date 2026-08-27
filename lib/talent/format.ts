/**
 * Formatting the talent screens share. Pure functions with no React and no
 * database, so a salary range reads the same on a job card, a public careers
 * page and a submission sent to a client.
 */

import { SALARY_PERIOD, label } from "./types";

const money0 = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

export function money(amount: number | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined) return "—";
  if (currency === "USD") return money0.format(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * A pay range as a recruiter writes it. An open-ended range is common and
 * meaningful -- "from $90k" is a real thing to advertise -- so one missing end
 * is not treated as missing data.
 */
export function salaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = "USD",
  period = "year"
): string {
  if (min == null && max == null) return "Not stated";
  const per = period === "year" ? "" : ` / ${label(SALARY_PERIOD, period)}`;
  if (min != null && max != null) {
    return `${money(min, currency)} – ${money(max, currency)}${per}`;
  }
  if (min != null) return `From ${money(min, currency)}${per}`;
  return `Up to ${money(max, currency)}${per}`;
}

/** A date that came out of the database as YYYY-MM-DD, shown without shifting. */
export function onDay(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function onDayTime(stamp: string | null | undefined): string {
  if (!stamp) return "—";
  return new Date(stamp).toLocaleString("en-US", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/**
 * How long ago, in the words a person would use. Anything older than a month
 * gets the date instead, because "63 days ago" makes the reader do arithmetic.
 */
export function ago(stamp: string | null | undefined): string {
  if (!stamp) return "Never";
  const then = new Date(stamp).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 31) return `${days} days ago`;
  return onDay(stamp);
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function place(
  city: string | null | undefined,
  state: string | null | undefined,
  country?: string | null
): string {
  const bits = [city, state, country && country !== "US" ? country : null].filter(Boolean);
  return bits.length ? bits.join(", ") : "—";
}

/**
 * A URL-safe slug for a public job page, with a short random tail so that two
 * "Sales Development Representative" postings do not collide.
 */
export function jobSlug(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "role";
  return `${stem}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A token for a share link or a portal invitation. */
export function shareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Splits a typed name into two parts. The last word is the surname, which is
 * wrong for some names -- the profile has both fields for exactly that reason,
 * and this only ever runs on the quick-add box.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}
