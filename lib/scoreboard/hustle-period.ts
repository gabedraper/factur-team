const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The server runs in UTC, so "today" per the wall clock must be computed in
// Central time explicitly -- otherwise "Today" flips a day early every evening.
function nowInCentral(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeekMonday(d: Date) {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

export type PeriodButton = { key: string; label: string };

export function buildPeriodButtons(now: Date = nowInCentral()): PeriodButton[] {
  const today = startOfDay(now);
  const monday = startOfWeekMonday(today);
  const todayIndex = (today.getDay() + 6) % 7; // Mon=0..Sun=6

  const buttons: PeriodButton[] = [];
  for (let i = 0; i <= todayIndex; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    buttons.push({
      key: `d:${isoDate(d)}`,
      label: i === todayIndex ? "Today" : WEEKDAY_NAMES[i],
    });
  }

  buttons.push(
    { key: "w:this", label: "This Week" },
    { key: "w:last", label: "Last Week" },
    { key: "m:this", label: "This Month" },
    { key: "m:last", label: "Last Month" }
  );

  return buttons;
}

export function defaultPeriodKey(now: Date = nowInCentral()): string {
  return `d:${isoDate(startOfDay(now))}`;
}

export function isValidPeriodKey(key: string): boolean {
  return /^d:\d{4}-\d{2}-\d{2}$/.test(key)
    || /^w:(this|last)$/.test(key)
    || /^m:(this|last)$/.test(key);
}

export function rangeForPeriodKey(key: string, now: Date = nowInCentral()) {
  const today = startOfDay(now);

  if (key.startsWith("d:")) {
    const date = key.slice(2);
    return { start: date, end: date };
  }

  if (key.startsWith("w:")) {
    const monday = startOfWeekMonday(today);
    const which = key.slice(2);

    if (which === "this") {
      return { start: isoDate(monday), end: isoDate(today) };
    }
    const weekStart = new Date(monday);
    weekStart.setDate(monday.getDate() - 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { start: isoDate(weekStart), end: isoDate(weekEnd) };
  }

  if (key.startsWith("m:")) {
    const which = key.slice(2);
    if (which === "this") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: isoDate(start), end: isoDate(today) };
    }
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: isoDate(start), end: isoDate(end) };
  }

  return { start: isoDate(today), end: isoDate(today) };
}
