import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { soql, stripAttributes } from "@/lib/salesforce/client";

/*
 * Salesforce, every few minutes.
 *
 * The one-time backfill moved 2.4 million rows through the Bulk API and COPY.
 * This is the other half: the small, frequent question of what has changed since
 * we last looked. A busy hour is a few hundred records, so the work per run is
 * seconds -- the volume problem only ever existed for the initial load.
 *
 * Each object is asked for rows with LastModifiedDate past its watermark, the
 * rows go into the mirror, and only then does the watermark move. Failing before
 * that means the next run re-fetches; re-fetching is free and missing a row is
 * silent, so the order matters.
 *
 * Transforms run once at the end rather than per object, in dependency order,
 * because an opportunity needs its account and contact to exist first.
 */

export const maxDuration = 300;

/** Objects in dependency order, with the mirror each one lands in. */
const OBJECTS = [
  { name: "Clients__c", mirror: "sky_Client" },
  { name: "Account", mirror: "sky_Account" },
  { name: "Contact", mirror: "sky_Contact" },
  { name: "Campaign", mirror: "sky_Campaign" },
  { name: "Opportunity", mirror: "sky_Opportunity" },
  { name: "Task", mirror: "sky_Task" },
  { name: "Event", mirror: "sky_Event" },
] as const;

/*
 * A ceiling per object per run. If something in Salesforce touches half a million
 * records at once -- a mass update, a data fix -- this run takes its slice and the
 * next one continues from the new watermark, rather than one run trying to carry
 * the whole thing and timing out forever.
 */
const MAX_PER_OBJECT = 20_000;

/* Rows per write. Wide enough to be worth a round trip, small enough that one
 * statement finishes well inside the timeout. */
const WRITE_BATCH = 500;

/* Salesforce writes timestamps as 2026-09-09T11:22:33.000+0000. */
function soqlTime(iso: string) {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();
  const { data: secretRow } = await db
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value
    ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  /*
   * One run at a time. On 3 September a job on a one-minute schedule that took
   * eight minutes stacked on itself until the database ran out of connections.
   * A run that cannot claim the lease does nothing and says so.
   */
  const { data: claimed } = await db.rpc("claim_salesforce_sync", { p_by: "cron" });
  if (!claimed) {
    return NextResponse.json({ skipped: true, why: "a sync is already running" });
  }

  const summary: Record<string, unknown> = {};
  let oldestWatermark: string | null = null;

  try {
    const { data: state } = await db
      .from("salesforce_sync_state").select("object, watermark");
    const watermarks = new Map(
      (state ?? []).map((r: { object: string; watermark: string | null }) => [r.object, r.watermark]),
    );

    for (const { name, mirror } of OBJECTS) {
      const since = watermarks.get(name) ?? null;
      if (!since) {
        /* No watermark means the backfill has not run for this object. Loading it
         * from nothing through this route would be the slow path we deliberately
         * left behind, so leave it for the bulk loader and say so. */
        summary[name] = { skipped: "no watermark - run the bulk load first" };
        continue;
      }

      const { data: cols } = await db.rpc("salesforce_mirror_columns", { p_table: mirror });
      const fields = (cols as string[] | null) ?? [];
      if (fields.length === 0) {
        summary[name] = { skipped: `mirror ${mirror} does not exist` };
        continue;
      }

      const rows = await soql<Record<string, unknown>>(
        `SELECT ${fields.join(", ")} FROM ${name} ` +
        `WHERE LastModifiedDate > ${soqlTime(since)} ` +
        `ORDER BY LastModifiedDate ASC LIMIT ${MAX_PER_OBJECT}`,
      );

      if (rows.length === 0) {
        summary[name] = { changed: 0 };
        continue;
      }

      /* Every mirror column is text; Salesforce hands back typed JSON. */
      const payload = rows.map((r) => {
        const flat = stripAttributes(r);
        const out: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(flat)) {
          out[k] = v === null || v === undefined ? null : String(v);
        }
        return out;
      });

      /*
       * In batches, because these rows are wide -- an opportunity carries 335
       * columns and a contact 339. A single upsert of a few thousand of them is
       * megabytes of JSON and one very long statement, which is how the first
       * run of this died: "canceling statement due to statement timeout". Small
       * writes also mean a failure loses one batch rather than the whole run.
       */
      for (let i = 0; i < payload.length; i += WRITE_BATCH) {
        const slice = payload.slice(i, i + WRITE_BATCH);
        const { error } = await db.from(mirror).upsert(slice, { onConflict: "Id" });
        if (error) {
          throw new Error(
            `${name}: writing rows ${i}-${i + slice.length} to ${mirror} failed - ${error.message}`,
          );
        }
      }

      /* Advance only as far as the rows we actually stored. */
      const newest = payload[payload.length - 1].LastModifiedDate ?? since;
      await db.rpc("record_salesforce_sync", {
        p_object: name, p_watermark: newest, p_rows: rows.length, p_error: null,
      });

      summary[name] = { changed: rows.length, watermark: newest };
      if (!oldestWatermark || since < oldestWatermark) oldestWatermark = since;
    }

    /*
     * The transforms are not called from here. They are pure SQL over tables
     * already in this database, and running them through the API meant running
     * them as the authenticator role, which carries statement_timeout=8s -- half
     * a minute of Salesforce changes takes about nineteen seconds to transform,
     * so every run was cancelled part-way. The salesforce-transforms cron job
     * runs them in the database instead.
     *
     * The mirrors are the handover point between the two halves: this fills
     * them, that drains them a few minutes later, and neither waits on the
     * other.
     */
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.rpc("record_salesforce_sync", {
      p_object: "Opportunity", p_watermark: null, p_rows: 0, p_error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    /* Always give the lease back, or every later run skips until it goes stale. */
    await db.rpc("release_salesforce_sync");
  }
}
