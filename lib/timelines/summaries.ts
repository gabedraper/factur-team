import { createServiceClient } from "@/lib/supabase/server";
import { prospectingOwnerIds } from "@/lib/org";
import {
  assembleLeads, summariseByOwner, ALL_REPS, DELIVERED_LEADS_OWNER,
  NURTURE_STAGE, NURTURE_STATUS,
  type LeadRow, type TaskRow, type RepSummary,
} from "./assemble";

/**
 * The first day the tiles count from.
 *
 * A calendar year rather than a rolling window, because that is how the team
 * reads their own numbers -- "this year" is a thing people say, "the last 240
 * days" is not.
 */
export const METRICS_FROM = "2026-01-01";

const PAGE = 1000;
/** Pages read at once. Enough to hide the latency, not enough to exhaust the pool. */
const WIDTH = 8;

type Page = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}>;

/**
 * Read a whole table, asking for the row count once and then fetching the pages
 * concurrently.
 *
 * A quarter of a million rows is two hundred and fifty six pages. Walking them
 * one after another, waiting for each to come back before asking for the next,
 * is most of a minute of doing nothing. The count tells us up front how many
 * there are, so they can be asked for together.
 */
async function readAll<T>(what: string, page: (from: number) => Page): Promise<T[]> {
  const first = await page(0);
  if (first.error) throw new Error(`${what} query failed: ${first.error.message}`);

  const out = (first.data ?? []) as T[];
  const total = first.count ?? out.length;
  if (total <= PAGE) return out;

  const offsets: number[] = [];
  for (let from = PAGE; from < total; from += PAGE) offsets.push(from);

  for (let i = 0; i < offsets.length; i += WIDTH) {
    const batch = await Promise.all(offsets.slice(i, i + WIDTH).map((from) => page(from)));
    for (const res of batch) {
      if (res.error) throw new Error(`${what} query failed: ${res.error.message}`);
      out.push(...((res.data ?? []) as T[]));
    }
  }
  return out;
}

type Row = {
  owner_id: string; leads: number; touches: number;
  hit_target: number; same_day: number; never_touched: number;
  median_first_touch: number | null; median_respond: number | null;
  touched_every_day: number; untouched_all_week: number;
  median_days_touched: number | null; median_gap: number | null;
  median_touches: number | null; meetings: number; gone_quiet: number;
  window_from: string; generated_at: string;
};

function toSummary(r: Row): RepSummary {
  return {
    leads: r.leads, touches: r.touches,
    hitTarget: r.hit_target, sameDay: r.same_day, neverTouched: r.never_touched,
    medianFirstTouch: r.median_first_touch, medianRespond: r.median_respond,
    touchedEveryDay: r.touched_every_day, untouchedAllWeek: r.untouched_all_week,
    medianDaysTouched: r.median_days_touched, medianGap: r.median_gap,
    medianTouches: r.median_touches, meetings: r.meetings, goneQuiet: r.gone_quiet,
  };
}

/** The stored tiles. Empty when the rebuild has never run. */
export async function readSummaries(): Promise<{
  summaries: Record<string, RepSummary>;
  generatedAt: string | null;
  windowFrom: string | null;
}> {
  const { data } = await createServiceClient().from("timeline_summaries").select("*");
  const rows = (data ?? []) as unknown as Row[];

  const summaries: Record<string, RepSummary> = {};
  for (const r of rows) summaries[r.owner_id] = toSummary(r);

  return {
    summaries,
    generatedAt: rows.length
      ? rows.reduce((a, b) => (a.generated_at > b.generated_at ? a : b)).generated_at
      : null,
    // The date the stored figures count from, so the page can say so out loud
    // rather than leaving the reader to guess at the window.
    windowFrom: rows.length ? rows[0].window_from : null,
  };
}

/**
 * Read every lead since METRICS_FROM with its activity, summarise it per rep,
 * and store the result.
 *
 * Runs off the request path. Unscoped on purpose: it summarises everyone once,
 * and the page hands out only the rows the viewer is allowed to see. Scoping
 * here instead would mean one rebuild per viewer, which is the cost this exists
 * to avoid.
 */
export async function rebuildSummaries(): Promise<{
  reps: number; leads: number; activity: number; ms: number;
}> {
  const started = Date.now();
  const db = createServiceClient();
  const prospectors = await prospectingOwnerIds();

  const rows = await readAll<LeadRow>("summary leads", (from) =>
    db
      .from("sf_opp_leads_raw")
      .select(
        "id,name,stagename,createddate,ownerid,owner_name,accountid,account_name," +
          "account_contact_name__c,contact_title__c,client__r_name,lead_source__c," +
          "prospecting_lead_status__c,cadence__c,sequence_name__c,lost_reason__c," +
          "referred_by_name__c",
        { count: from === 0 ? "exact" : undefined }
      )
      .gte("createddate", `${METRICS_FROM}T00:00:00Z`)
      .neq("ownerid", DELIVERED_LEADS_OWNER)
      .neq("stagename", NURTURE_STAGE)
      // Spelt as an "or" because a plain "not equal" drops nulls too, and most
      // of these leads have no prospecting status at all.
      .or(`prospecting_lead_status__c.is.null,prospecting_lead_status__c.neq.${NURTURE_STATUS}`)
      .order("createddate", { ascending: false })
      .range(from, from + PAGE - 1)
  );

  /*
   * Activity is read a hundred lead ids at a time, because whatid is the only
   * column this table is indexed on.
   *
   * Reading it straight through ordered by date looks tidier and times out: a
   * quarter of a million rows get sorted afresh for every page, and the
   * database gives up around the thirtieth. Asking by lead id is an index
   * lookup, and the batches run together so the round trips still overlap.
   */
  const slices: string[][] = [];
  for (let i = 0; i < rows.length; i += 100) slices.push(rows.slice(i, i + 100).map((r) => r.id));

  const tasks: TaskRow[] = [];
  for (let i = 0; i < slices.length; i += WIDTH) {
    const batch = await Promise.all(
      slices.slice(i, i + WIDTH).map(async (slice) => {
        const out: TaskRow[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await db
            .from("sf_opp_tasks_raw")
            .select("id,whatid,subject,tasksubtype,calltype,createddate,owner_name")
            .in("whatid", slice)
            .order("createddate", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(`summary activity query failed: ${error.message}`);
          const page = (data ?? []) as unknown as TaskRow[];
          out.push(...page);
          if (page.length < PAGE) break;
        }
        return out;
      })
    );
    for (const page of batch) tasks.push(...page);
  }

  const pipelineFor = (row: LeadRow) =>
    row.ownerid && prospectors.has(row.ownerid) ? ("prospecting" as const) : ("client" as const);

  const assembled = assembleLeads(rows, tasks, pipelineFor);
  const summaries = summariseByOwner(assembled.leads);

  const generated_at = new Date().toISOString();
  const records = Object.entries(summaries).map(([ownerId, s]) => ({
    owner_id: ownerId,
    leads: s.leads, touches: s.touches,
    hit_target: s.hitTarget, same_day: s.sameDay, never_touched: s.neverTouched,
    median_first_touch: s.medianFirstTouch, median_respond: s.medianRespond,
    touched_every_day: s.touchedEveryDay, untouched_all_week: s.untouchedAllWeek,
    median_days_touched: s.medianDaysTouched, median_gap: s.medianGap,
    median_touches: s.medianTouches, meetings: s.meetings, gone_quiet: s.goneQuiet,
    window_from: METRICS_FROM,
    generated_at,
  }));

  // Replace rather than merge: a rep with no leads this year should disappear
  // from the tiles, not keep last week's figures for ever.
  await db.from("timeline_summaries").delete().neq("owner_id", "");
  if (records.length) {
    const { error } = await db.from("timeline_summaries").upsert(records, { onConflict: "owner_id" });
    if (error) throw new Error(`summary write failed: ${error.message}`);
  }

  return {
    reps: records.length - (summaries[ALL_REPS] ? 1 : 0),
    leads: rows.length,
    activity: tasks.length,
    ms: Date.now() - started,
  };
}


/**
 * Rebuild the tiles if nobody else is doing it and they have gone stale.
 *
 * Called after the response has been sent, so the person who happened to open
 * the page pays no waiting for it -- they see the previous hour's tiles and the
 * next visitor sees the new ones. The claim is taken in the database, so two
 * people opening the page together still only produce one rebuild.
 */
export async function refreshSummariesIfStale(staleMinutes = 60): Promise<void> {
  const db = createServiceClient();

  const { data: claimed } = await db.rpc("claim_timeline_rebuild", {
    p_stale_minutes: staleMinutes,
  });
  if (!claimed) return;

  try {
    await rebuildSummaries();
    await db.rpc("finish_timeline_rebuild", { p_problem: null });
  } catch (e) {
    // Recorded rather than thrown: this runs with nobody watching, and a
    // rebuild that fails silently is how the tiles quietly freeze.
    await db.rpc("finish_timeline_rebuild", {
      p_problem: e instanceof Error ? e.message : "Unknown error",
    });
  }
}
