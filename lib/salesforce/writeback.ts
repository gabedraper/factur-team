import { createServiceClient } from "@/lib/supabase/server";
import { getRecord, updateRecord } from "@/lib/salesforce/client";

/*
 * App edits, pushed to Salesforce.
 *
 * Queued by the save action and pushed by pushEdits(), which the same request
 * calls after answering the user and a cron job calls again for anything left
 * behind. Every field is logged before it is sent and checked against
 * Salesforce after, so the test question -- did this actually land -- is
 * answered by reading a table rather than by opening Salesforce.
 *
 * Three deliberate limits while this is a test:
 *   - only people in salesforce_writeback_testers,
 *   - only opportunities that already exist in Salesforce,
 *   - only the fields below, which are the ones the inbound sync reads back.
 *
 * The last one matters more than it looks. Pushing a field the sync does not
 * read would make the two sides disagree permanently, and pushing one the sync
 * DOES read that Salesforce computes itself would start a fight the app loses
 * every three minutes.
 */

/** App column -> the Salesforce field the inbound transform reads it from. */
export const FIELD_MAP = {
  stage:            { sf: "StageName",                     kind: "text" },
  lead_status:      { sf: "Prospecting_Lead_Status__c",     kind: "text" },
  notes:            { sf: "Opportunity_Notes__c",           kind: "text" },
  updates:          { sf: "Updates__c",                     kind: "text" },
  next_action_date: { sf: "Next_Action__c",                 kind: "date" },
  /* The app holds our own account id; Salesforce wants its own. */
  account_id:       { sf: "AccountId",                      kind: "account" },
} as const;

export type PushableField = keyof typeof FIELD_MAP;
export const PUSHABLE_FIELDS = Object.keys(FIELD_MAP) as PushableField[];
const SF_FIELDS = PUSHABLE_FIELDS.map((f) => FIELD_MAP[f].sf);

/*
 * Not pushed, on purpose: the reached_* flags and closed_on. Salesforce sets
 * the reached flags from its own automation when a stage moves, so pushing our
 * copy would either be overwritten immediately or fight the flow that owns
 * them. Moving the stage is what makes Salesforce set them.
 */

type Row = Record<string, unknown>;

/** Trailing spaces, empty strings and a date's time part are not differences. */
function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  /* Salesforce returns dates as 2026-09-15, sometimes with a time on datetimes. */
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : s;
}

export type QueueInput = {
  memberId: string | null;
  opportunityId: string;
  /** The row as it was before the update -- mapped columns plus the SF id. */
  before: Row;
  /** Only what the save actually changed. */
  patch: Row;
};

/**
 * Records what to push, and answers with the ids so the caller can push them
 * in the same request. Returns an empty list whenever the feature is off, the
 * person is not a tester, the opportunity is not in Salesforce, or nothing
 * mapped actually changed -- all of which are ordinary, not failures.
 */
export async function queueEdit(input: QueueInput): Promise<{ editId: string | null; ids: number[] }> {
  const db = createServiceClient();

  const [{ data: settings }, { data: tester }] = await Promise.all([
    db.from("salesforce_writeback_settings").select("enabled").eq("id", true).maybeSingle(),
    input.memberId
      ? db.from("salesforce_writeback_testers").select("member_id").eq("member_id", input.memberId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!(settings as { enabled: boolean } | null)?.enabled) return { editId: null, ids: [] };
  if (!tester) return { editId: null, ids: [] };

  const salesforceId = norm(input.before.salesforce_opportunity_id);
  if (!salesforceId) return { editId: null, ids: [] };

  const changed = PUSHABLE_FIELDS.filter(
    (f) => f in input.patch && norm(input.patch[f]) !== norm(input.before[f]),
  );
  if (changed.length === 0) return { editId: null, ids: [] };

  /* Our account id means nothing to Salesforce; look up its own. A company we
     hold that Salesforce does not is logged as skipped rather than dropped --
     silence is what makes a sync impossible to trust. */
  const accountIds = [input.patch.account_id, input.before.account_id].filter(Boolean) as string[];
  const sfAccounts = new Map<string, string | null>();
  if (changed.includes("account_id") && accountIds.length) {
    const { data } = await db
      .from("crm_accounts").select("id, salesforce_account_id").in("id", accountIds);
    for (const a of (data ?? []) as Array<{ id: string; salesforce_account_id: string | null }>) {
      sfAccounts.set(a.id, a.salesforce_account_id);
    }
  }

  const editId = crypto.randomUUID();
  const rows = changed.map((field) => {
    const map = FIELD_MAP[field];
    const translate = (v: unknown) =>
      map.kind === "account" ? (v ? sfAccounts.get(String(v)) ?? null : null) : norm(v);
    const newValue = translate(input.patch[field]);
    const missingAccount = map.kind === "account" && input.patch[field] && !newValue;
    return {
      edit_id: editId,
      member_id: input.memberId,
      opportunity_id: input.opportunityId,
      salesforce_id: salesforceId,
      field,
      sf_field: map.sf,
      old_value: translate(input.before[field]),
      new_value: newValue,
      status: missingAccount ? "skipped" : "queued",
      error: missingAccount ? "That company has no Salesforce id." : null,
    };
  });

  const { data: inserted, error } = await db
    .from("salesforce_writeback_log").insert(rows).select("id, status");
  if (error) throw new Error(`Could not record the Salesforce push: ${error.message}`);

  return {
    editId,
    ids: ((inserted ?? []) as Array<{ id: number; status: string }>)
      .filter((r) => r.status === "queued").map((r) => r.id),
  };
}

type LogRow = {
  id: number;
  edit_id: string;
  opportunity_id: string;
  salesforce_id: string;
  field: string;
  sf_field: string;
  old_value: string | null;
  new_value: string | null;
  attempts: number;
};

/**
 * Pushes queued rows, by edit, and checks each one afterwards.
 *
 * Claiming is a conditional update rather than a select then update: two
 * workers overlap constantly here (a save pushes its own rows while the cron
 * job is sweeping), and only one of them may own a row.
 */
export async function pushEdits({ ids, limit = 50 }: { ids?: number[]; limit?: number } = {}): Promise<{
  pushed: number; verified: number; mismatched: number; conflicts: number; failed: number; skipped: number;
}> {
  const db = createServiceClient();
  const tally = { pushed: 0, verified: 0, mismatched: 0, conflicts: 0, failed: 0, skipped: 0 };

  let pick = db.from("salesforce_writeback_log").select("id").eq("status", "queued").order("id").limit(limit);
  if (ids?.length) pick = pick.in("id", ids);
  const { data: candidates } = await pick;
  const wanted = ((candidates ?? []) as Array<{ id: number }>).map((r) => r.id);
  if (wanted.length === 0) return tally;

  const { data: claimedRows } = await db
    .from("salesforce_writeback_log")
    .update({ status: "sending" })
    .in("id", wanted)
    .eq("status", "queued")
    .select("id, edit_id, opportunity_id, salesforce_id, field, sf_field, old_value, new_value, attempts");
  const claimed = (claimedRows ?? []) as LogRow[];
  if (claimed.length === 0) return tally;

  const byEdit = new Map<string, LogRow[]>();
  for (const row of claimed) byEdit.set(row.edit_id, [...(byEdit.get(row.edit_id) ?? []), row]);

  for (const [, rows] of byEdit) {
    const salesforceId = rows[0].salesforce_id;
    const finish = async (row: LogRow, patch: Record<string, unknown>) => {
      await db.from("salesforce_writeback_log")
        .update({ ...patch, attempts: row.attempts + 1, checked_at: new Date().toISOString() })
        .eq("id", row.id);
    };

    let before: Record<string, unknown> | null;
    try {
      before = await getRecord("Opportunity", salesforceId, SF_FIELDS);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      for (const row of rows) await finish(row, { status: "queued", error });
      tally.failed += rows.length;
      continue;
    }

    if (!before) {
      for (const row of rows) {
        await finish(row, { status: "failed", error: "Salesforce has no such opportunity, or the sync user cannot see it." });
      }
      tally.failed += rows.length;
      continue;
    }

    /*
     * Conflict: Salesforce holds something that is neither what the app had
     * before the edit nor what it is being set to -- so somebody changed it
     * over there since our last sync, and pushing would erase their change
     * without anyone knowing. Left for a person to look at.
     */
    const toSend: LogRow[] = [];
    for (const row of rows) {
      const sfBefore = norm(before[row.sf_field]);
      if (sfBefore !== null && sfBefore !== row.old_value && sfBefore !== row.new_value) {
        await finish(row, { status: "conflict", sf_before: sfBefore, error: "Changed in Salesforce since this edit." });
        tally.conflicts += 1;
      } else {
        toSend.push(row);
        await db.from("salesforce_writeback_log").update({ sf_before: sfBefore }).eq("id", row.id);
      }
    }
    if (toSend.length === 0) continue;

    const payload: Record<string, unknown> = {};
    for (const row of toSend) payload[row.sf_field] = row.new_value;

    const result = await updateRecord("Opportunity", salesforceId, payload);
    if (!result.ok) {
      for (const row of toSend) {
        const giveUp = !result.retryable || row.attempts + 1 >= 5;
        await finish(row, { status: giveUp ? "failed" : "queued", error: result.error });
      }
      tally.failed += toSend.length;
      continue;
    }

    const sentAt = new Date().toISOString();
    /* Read it straight back. Salesforce accepting a write is not the same as
       Salesforce keeping it -- a flow or a validation rule can rewrite the
       value on save, and that is exactly what this test needs to surface. */
    let after: Record<string, unknown> | null = null;
    try {
      after = await getRecord("Opportunity", salesforceId, SF_FIELDS);
    } catch {
      /* The write landed; only the check failed. Says so below. */
    }

    for (const row of toSend) {
      tally.pushed += 1;
      if (!after) {
        await finish(row, { status: "sent", sent_at: sentAt, error: "Pushed, but reading it back failed." });
        continue;
      }
      const sfAfter = norm(after[row.sf_field]);
      const agrees = sfAfter === row.new_value;
      if (agrees) tally.verified += 1; else tally.mismatched += 1;
      await finish(row, {
        status: agrees ? "verified" : "mismatch",
        sent_at: sentAt,
        sf_after: sfAfter,
        error: agrees ? null : "Salesforce holds a different value after the push.",
      });
    }
  }

  return tally;
}

/**
 * Rows a crash left claimed. A push is the same values written again, so
 * retrying one that did land costs nothing but a second write.
 */
export async function requeueStuck(olderThanMinutes = 10): Promise<number> {
  const db = createServiceClient();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const { data } = await db
    .from("salesforce_writeback_log")
    .update({ status: "queued" })
    .eq("status", "sending")
    .lt("created_at", cutoff)
    .select("id");
  return (data ?? []).length;
}
