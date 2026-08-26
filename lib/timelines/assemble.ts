// Pure assembly: rows in, timeline shape out. No Supabase and no request
// context, so this can be exercised directly against live or fixture rows.
import {
  classify, stageBucket, outcomeFor, prospectingBucket, prospectingOutcomeFor,
  norm, SEQUENCE_RE, REP_TOUCH, PROSPECT_SIGNAL, DROPPED, COLD_AFTER_DAYS,
  FIRST_RESPONSE_TARGET_H, type EventKind,
} from "./classify";
import { median } from "./stats";
import { parseUtc } from "./business-day";

/**
 * Two pipelines run through the same Opportunity object.
 *
 * Account managers serve clients and record progress in Stage. The sales team
 * -- BDMs and SDRs -- sell Factur's own services and record progress in
 * Prospecting Lead Status instead, always against the one client "Factur
 * Outsourced Prospecting". Same records, different field, different vocabulary,
 * so the timeline reads whichever one the owner's role says is in use.
 */
export type Pipeline = "client" | "prospecting";

export const SF_BASE = "https://factur.lightning.force.com";
export { COLD_AFTER_DAYS };


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
  client: string | null; rep: string | null; ownerId: string | null; source: string;
  pipeline: Pipeline;
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
  prospecting_lead_status__c: string | null;
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

function stageSpans(events: TimelineEvent[], stage: string, pipeline: Pipeline): StageSpan[] {
  // Each pipeline's changes are logged as their own kind of Task, so the lane
  // is drawn from the history of whichever field that pipeline actually uses.
  const kind = pipeline === "prospecting" ? "status_change" : "stage_change";
  const bucketOf = pipeline === "prospecting" ? prospectingBucket : stageBucket;

  const changes = events.filter((e) => e.kind === kind);
  if (!changes.length) {
    return [{ fromHours: 0, stage, bucket: bucketOf(stage), at: null, actor: null }];
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
      bucket: bucketOf(e.detail),
      at: e.at,
      actor: e.actor,
    });
  }
  return spans;
}


function buildLead(row: LeadRow, rawTasks: TaskRow[], now: Date, pipeline: Pipeline): Lead {

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

  const stageName = row.stagename || "";
  // What the lane and the chip are actually about: the field this pipeline
  // records progress in.
  const stage =
    pipeline === "prospecting" ? row.prospecting_lead_status__c || stageName : stageName;

  const { key, label, status } =
    pipeline === "prospecting"
      ? prospectingOutcomeFor(row.prospecting_lead_status__c, stageName, daysSince, row.referred_by_name__c)
      : outcomeFor(stageName, daysSince, row.referred_by_name__c);

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
    ownerId: row.ownerid,
    pipeline,
    source: row.lead_source__c || "Unattributed",
    cadence: row.cadence__c,
    sequence: row.sequence_name__c,
    created: row.createddate,
    stage,
    stageSpans: stageSpans(events, stage, pipeline),
    outcome: key,
    outcomeLabel: label,
    status,
    journey: events
      .filter((e) => e.kind === (pipeline === "prospecting" ? "status_change" : "stage_change"))
      .map((e) => e.detail),
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

export function assembleLeads(
  rows: LeadRow[],
  tasks: TaskRow[],
  pipelineFor: (row: LeadRow) => Pipeline = () => "client"
) {
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
    leads: rows.map((row) => buildLead(row, byOpp.get(row.id) ?? [], now, pipelineFor(row))),
    generated: now.toISOString(),
    coldAfterDays: COLD_AFTER_DAYS,
    sfBase: SF_BASE,
  };
}


/**
 * The numbers behind the headline tiles, for one set of leads.
 *
 * Kept separate from the leads sent to the browser because the tiles answer a
 * different question from the board: the board shows the leads that arrived
 * this week, while the tiles are meant to be the rep's record over everything
 * held -- so filtering the board must not move them.
 */
export type RepSummary = {
  leads: number; touches: number;
  hitTarget: number; sameDay: number; neverTouched: number;
  medianFirstTouch: number | null; medianRespond: number | null;
  touchedEveryDay: number; untouchedAllWeek: number;
  medianDaysTouched: number | null; medianGap: number | null;
  medianTouches: number | null; meetings: number; goneQuiet: number;
};

export { median };

export function summarise(leads: Lead[]): RepSummary {
  const m = (pick: (l: Lead) => number | null) => median(leads.map(pick));
  const count = (test: (l: Lead) => boolean) => leads.filter(test).length;

  return {
    leads: leads.length,
    touches: leads.reduce((a, l) => a + l.metrics.touches, 0),
    hitTarget: count(
      (l) => l.metrics.firstTouchHours !== null && l.metrics.firstTouchHours <= FIRST_RESPONSE_TARGET_H
    ),
    sameDay: count((l) => l.metrics.firstDayTouches > 0),
    neverTouched: count((l) => l.metrics.firstTouchHours === null),
    medianFirstTouch: m((l) => l.metrics.firstTouchHours),
    medianRespond: m((l) => l.metrics.respondHours),
    touchedEveryDay: count((l) => l.metrics.firstWeekDaysTouched >= l.metrics.firstWeekDaysElapsed),
    untouchedAllWeek: count((l) => l.metrics.firstWeekDaysTouched === 0),
    medianDaysTouched: m((l) => l.metrics.firstWeekDaysTouched),
    medianGap: m((l) => l.metrics.medianGapDays),
    medianTouches: m((l) => l.metrics.touches),
    meetings: count((l) => l.metrics.meetings > 0),
    goneQuiet: count((l) => l.outcome === "cold"),
  };
}

/**
 * Leads delivered to a client for the client to follow up.
 *
 * The Lead Generation service hands finished leads over, and the client works
 * them from there -- so nobody at Factur is meant to touch one, and 24,432 of
 * them sitting untouched is the service working rather than anyone failing.
 * Counted as leads they made 62% of all leads look untouched and 51% never
 * contacted, which is a description of the wrong thing.
 *
 * They are held by one Salesforce user rather than a person, and there is no
 * field that separates them: "Lead Generated" is also a stage 823 leads owned
 * by real reps have reached honestly.
 */
export const DELIVERED_LEADS_OWNER = "005VI00000LjYe9YAF"; // Service Delivery Operations

/** How far back the board itself shows leads. */
export const DISPLAY_DAYS = 7;

/**
 * How far back the headline tiles reach.
 *
 * Deliberately shorter than the 90 days the sync now holds. The tiles are built
 * by assembling every lead and its activity in memory, which is the right tool
 * for a few thousand leads and the wrong one for thirteen thousand -- that is
 * what the Stage Journey page uses SQL for. Thirty days is also the honest span
 * for "how is this rep working leads now".
 */
export const METRICS_DAYS = 30;

/** Key used for the summary covering everyone in view, not one rep. */
export const ALL_REPS = "__all";

/**
 * One summary per rep, plus one for everyone. Medians cannot be combined after
 * the fact, so each set is summarised over its own leads rather than rolled up.
 */
export function summariseByOwner(leads: Lead[]): Record<string, RepSummary> {
  const byOwner = new Map<string, Lead[]>();
  for (const l of leads) {
    if (!l.ownerId) continue;
    const list = byOwner.get(l.ownerId);
    if (list) list.push(l);
    else byOwner.set(l.ownerId, [l]);
  }

  const out: Record<string, RepSummary> = { [ALL_REPS]: summarise(leads) };
  for (const [ownerId, own] of byOwner) out[ownerId] = summarise(own);
  return out;
}
