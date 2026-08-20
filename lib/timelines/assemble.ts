// Pure assembly: rows in, timeline shape out. No Supabase and no request
// context, so this can be exercised directly against live or fixture rows.
import {
  classify, stageBucket, outcomeFor, norm, SEQUENCE_RE,
  REP_TOUCH, PROSPECT_SIGNAL, DROPPED, COLD_AFTER_DAYS,
  type EventKind,
} from "./classify";

export const SF_BASE = "https://factur.lightning.force.com";
export { COLD_AFTER_DAYS };

// Coupler writes `timestamp without time zone` holding UTC. Postgres hands
// those back with no zone, which Date would read as local time -- an offset
// large enough to move events across day boundaries in the week view.
function parseUtc(value: string): Date {
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + "Z");
}

export type TimelineEvent = {
  id: string; kind: EventKind; detail: string; at: string;
  hours: number; actor: string | null; sequence: string | null; url: string;
};

export type StageSpan = {
  fromHours: number; stage: string | null; bucket: string;
  at: string | null; actor: string | null;
};

export type Lead = {
  id: string; url: string; name: string; contact: string;
  title: string | null; account: string | null; accountUrl: string | null;
  client: string | null; rep: string | null; source: string;
  cadence: string | null; sequence: string | null; created: string;
  stage: string; stageSpans: StageSpan[];
  outcome: string; outcomeLabel: string; status: string;
  journey: string[]; referredBy: string | null; lostReason: string | null;
  metrics: {
    firstTouchHours: number | null; respondHours: number | null;
    touches: number; calls: number; emails: number; signals: number;
    meetings: number; firstDayTouches: number;
    firstWeekDaysTouched: number; firstWeekDaysElapsed: number;
    medianGapDays: number | null; daysSinceLastEvent: number; spanHours: number;
  };
  events: TimelineEvent[];
};

export type LeadRow = {
  id: string; name: string | null; stagename: string | null;
  createddate: string; ownerid: string | null; owner_name: string | null;
  accountid: string | null; account_name: string | null;
  account_contact_name__c: string | null; contact_title__c: string | null;
  client__r_name: string | null; lead_source__c: string | null;
  cadence__c: string | null; sequence_name__c: string | null;
  lost_reason__c: string | null; referred_by_name__c: string | null;
};

export type TaskRow = {
  id: string; whatid: string; subject: string | null;
  tasksubtype: string | null; calltype: string | null;
  createddate: string; owner_name: string | null;
};


function hoursBetween(a: Date, b: Date): number {
  return Math.round(((b.getTime() - a.getTime()) / 3600000) * 100) / 100;
}

/**
 * Account_Contact_Name__c is empty on older records, but the Opportunity name
 * is assembled from the prospect account, the client and the contact -- in an
 * order that is not consistent. Drop the segments matching a company we already
 * know and whatever is left is the person.
 */
export function contactName(row: LeadRow): string {
  const explicit = row.account_contact_name__c;
  if (explicit) return explicit.trim();

  const known = new Set([norm(row.account_name), norm(row.client__r_name)]);
  known.delete("");

  const segments = (row.name || "").split(" - ").map((s) => s.trim()).filter(Boolean);
  const leftover = segments.filter((s) => {
    const n = norm(s);
    if (known.has(n)) return false;
    if (n && [...known].some((k) => k.includes(n))) return false;
    return !["account", "contact"].includes(s.toLowerCase());
  });

  // A person's name is short, has no corporate suffix, and is not a date or
  // some other numeric fragment that found its way into the record name.
  const people = leftover.filter(
    (s) =>
      s.split(/\s+/).length <= 4 &&
      !/\b(inc|llc|ltd|corp|co|company|mfg|group)\b/i.test(s) &&
      /[A-Za-z]{2}/.test(s) &&
      !/^[\d/\-.\s]+$/.test(s)
  );
  if (people.length) return people[people.length - 1];

  // No person in the name at all -- a renewal or house record. Show the whole
  // thing rather than a stray date fragment.
  return (row.name || "").trim();
}

function stageSpans(events: TimelineEvent[], stage: string): StageSpan[] {
  const changes = events.filter((e) => e.kind === "stage_change");
  if (!changes.length) {
    return [{ fromHours: 0, stage, bucket: stageBucket(stage), at: null, actor: null }];
  }
  // A stage-change Task records the stage moved *to*, so the stretch before the
  // first one is a stage this export cannot name -- marked unknown, not guessed.
  const spans: StageSpan[] = [
    { fromHours: 0, stage: null, bucket: "unknown", at: null, actor: null },
  ];
  for (const e of changes) {
    spans.push({
      fromHours: e.hours,
      stage: e.detail,
      bucket: stageBucket(e.detail),
      at: e.at,
      actor: e.actor,
    });
  }
  return spans;
}


function buildLead(row: LeadRow, rawTasks: TaskRow[], now: Date): Lead {

  const created = parseUtc(row.createddate);
  const events: TimelineEvent[] = [];

  for (const task of [...rawTasks].sort((a, b) =>
    a.createddate < b.createddate ? -1 : 1
  )) {
    const [kind, detail] = classify(task);
    if (DROPPED.has(kind)) continue;
    const when = parseUtc(task.createddate);
    const seq = SEQUENCE_RE.exec(task.subject || "");
    events.push({
      id: task.id,
      kind,
      detail,
      at: task.createddate,
      // 57 activities across 50 leads carry a CreatedDate up to three days
      // before their opportunity's -- almost certainly the outreach that caused
      // the record to be created. Negative hours would draw off the left edge
      // and make "first touch" a negative duration, so they land at zero.
      hours: Math.max(0, hoursBetween(created, when)),
      actor: task.owner_name,
      sequence: seq ? seq[1] : null,
      url: `${SF_BASE}/lightning/r/Task/${task.id}/view`,
    });
  }

  const touches = events.filter((e) => REP_TOUCH.has(e.kind));
  const signals = events.filter((e) => PROSPECT_SIGNAL.has(e.kind));

  // Speed to first touch: lead created -> rep's first outbound.
  const firstTouchHours = touches.length ? touches[0].hours : null;

  // Speed to respond: first prospect signal -> the rep's next outbound.
  let respondHours: number | null = null;
  if (signals.length) {
    const signalAt = signals[0].hours;
    const after = touches.find((t) => t.hours >= signalAt);
    if (after) respondHours = Math.round((after.hours - signalAt) * 100) / 100;
  }

  // Day 0 is the day the lead arrived, so the set is {0..6}.
  const weekDays = new Set(
    touches.filter((t) => t.hours < 7 * 24).map((t) => Math.floor(t.hours / 24))
  );

  const gaps = touches
    .slice(1)
    .map((b, i) => Math.round(((b.hours - touches[i].hours) / 24) * 100) / 100)
    .sort((a, b) => a - b);
  const medianGapDays = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  const last = events.length ? events[events.length - 1] : null;
  const daysSince =
    Math.round(
      ((now.getTime() - (last ? parseUtc(last.at) : created).getTime()) / 86400000) * 100
    ) / 100;

  const stage = row.stagename || "";
  const { key, label, status } = outcomeFor(stage, daysSince, row.referred_by_name__c);

  return {
    id: row.id,
    url: `${SF_BASE}/lightning/r/Opportunity/${row.id}/view`,
    name: row.name || "",
    contact: contactName(row),
    title: row.contact_title__c,
    account: row.account_name,
    accountUrl: row.accountid
      ? `${SF_BASE}/lightning/r/Account/${row.accountid}/view`
      : null,
    client: row.client__r_name,
    rep: row.owner_name,
    source: row.lead_source__c || "Unattributed",
    cadence: row.cadence__c,
    sequence: row.sequence_name__c,
    created: row.createddate,
    stage,
    stageSpans: stageSpans(events, stage),
    outcome: key,
    outcomeLabel: label,
    status,
    journey: events.filter((e) => e.kind === "stage_change").map((e) => e.detail),
    referredBy: row.referred_by_name__c,
    lostReason: row.lost_reason__c,
    metrics: {
      firstTouchHours,
      respondHours,
      touches: touches.length,
      calls: events.filter((e) => e.kind === "call").length,
      emails: events.filter((e) => e.kind === "email_out").length,
      signals: signals.length,
      meetings: events.filter((e) => e.kind === "meeting_booked").length,
      firstDayTouches: touches.filter((t) => t.hours < 24).length,
      firstWeekDaysTouched: weekDays.size,
      // Only judge the follow-up goal on days the lead has actually lived
      // through -- a lead that arrived this morning cannot have missed day 3.
      firstWeekDaysElapsed: Math.min(
        7,
        Math.floor(hoursBetween(created, now) / 24) + 1
      ),
      medianGapDays,
      daysSinceLastEvent: daysSince,
      spanHours: events.length ? events[events.length - 1].hours : 0,
    },
    events,
  };
  
}

export function assembleLeads(rows: LeadRow[], tasks: TaskRow[]) {
  const byOpp = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const list = byOpp.get(t.whatid);
    if (list) list.push(t);
    else byOpp.set(t.whatid, [t]);
  }

  // "Now" is the newest activity rather than the wall clock, so cold and
  // elapsed-days figures stay stable between syncs.
  const now = tasks.length
    ? new Date(Math.max(...tasks.map((t) => parseUtc(t.createddate).getTime())))
    : new Date();

  return {
    leads: rows.map((row) => buildLead(row, byOpp.get(row.id) ?? [], now)),
    generated: now.toISOString(),
    coldAfterDays: COLD_AFTER_DAYS,
    sfBase: SF_BASE,
  };
}
