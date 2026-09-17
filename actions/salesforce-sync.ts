"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions, currentMemberId } from "@/lib/org";
import { reconcileSalesforce } from "@/lib/salesforce/reconcile";
import { describeFields, type SalesforceField } from "@/lib/salesforce/client";

/* The sync's own numbers, for the settings page. Admins only. */

async function assertAdmin() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) throw new Error("Forbidden: org.manage required");
}

export type ReconRow = {
  object: string; scope: string;
  sf_count: number | null; mirror_count: number | null; app_count: number | null;
  note: string | null;
};
export type SyncState = {
  object: string; watermark: string | null; last_run_at: string | null;
  last_run_rows: number | null; last_error: string | null;
};

export async function getSyncState(): Promise<{
  checkedAt: string | null;
  previousAt: string | null;
  rows: ReconRow[];
  previous: ReconRow[];
  sync: SyncState[];
}> {
  await assertAdmin();
  const db = createServiceClient();

  const { data: times } = await db
    .from("salesforce_reconciliation").select("checked_at")
    .order("checked_at", { ascending: false }).limit(400);
  const distinct = [...new Set(((times ?? []) as { checked_at: string }[]).map((t) => t.checked_at))];
  const [checkedAt, previousAt] = [distinct[0] ?? null, distinct[1] ?? null];

  const at = async (t: string | null) =>
    t
      ? (((await db.from("salesforce_reconciliation").select("object,scope,sf_count,mirror_count,app_count,note")
          .eq("checked_at", t)).data ?? []) as ReconRow[])
      : [];
  const [rows, previous, { data: sync }] = await Promise.all([
    at(checkedAt), at(previousAt),
    db.from("salesforce_sync_state").select("object,watermark,last_run_at,last_run_rows,last_error").order("object"),
  ]);
  return { checkedAt, previousAt, rows, previous, sync: (sync ?? []) as SyncState[] };
}

export async function runReconcileNow(): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  try {
    await assertAdmin();
    const r = await reconcileSalesforce();
    revalidatePath("/integrations/salesforce");
    const d = r.deleted;
    return {
      ok: true,
      summary: `Checked. Removed ${d.opportunities} opportunities, ${d.quotes} quotes and ${d.orders} orders that Salesforce deleted.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The check failed." };
  }
}

/* ---- What is synced: objects, frequency, ceiling, fields ---- */

export type SyncObjectConfig = {
  object: string;
  mirror_table: string;
  label: string;
  enabled: boolean;
  every_minutes: number;
  max_per_run: number;
  /** null = every column the mirror has */
  fields: string[] | null;
  position: number;
  /** Columns the mirror table has today. */
  mirror_columns: string[];
  /** Columns a transform reads; cannot be unticked. */
  required: string[];
};

export async function getSyncConfig(): Promise<SyncObjectConfig[]> {
  await assertAdmin();
  const db = createServiceClient();
  const { data } = await db.from("salesforce_sync_objects").select("*").order("position");
  const rows = (data ?? []) as Omit<SyncObjectConfig, "mirror_columns" | "required">[];
  return Promise.all(rows.map(async (r) => {
    const [{ data: cols }, { data: req }] = await Promise.all([
      db.rpc("salesforce_mirror_columns", { p_table: r.mirror_table }),
      db.rpc("mirror_required_columns", { p_table: r.mirror_table }),
    ]);
    return { ...r, mirror_columns: (cols as string[] | null) ?? [], required: (req as string[] | null) ?? [] };
  }));
}

export async function setSyncObject(input: {
  object: string; enabled?: boolean; every_minutes?: number; max_per_run?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: await currentMemberId() };
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.every_minutes !== undefined) {
      const n = Math.round(Number(input.every_minutes));
      if (!Number.isFinite(n) || n < 1 || n > 1440) return { ok: false, error: "Every: between 1 and 1440 minutes." };
      patch.every_minutes = n;
    }
    if (input.max_per_run !== undefined) {
      const n = Math.round(Number(input.max_per_run));
      if (!Number.isFinite(n) || n < 100 || n > 50000) return { ok: false, error: "Rows per run: between 100 and 50,000." };
      patch.max_per_run = n;
    }
    const { error } = await createServiceClient()
      .from("salesforce_sync_objects").update(patch).eq("object", input.object);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/integrations/salesforce");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

/** Salesforce's own list of an object's fields, for the field picker. */
export async function describeObjectFields(object: string): Promise<SalesforceField[]> {
  await assertAdmin();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(object)) throw new Error("Not an object name.");
  return describeFields(object);
}

/**
 * Set which fields an object syncs. null means every mirror column. A chosen
 * list always keeps the fields the transforms read, and a field the mirror has
 * no column for gets one -- as text, like every other mirror column.
 */
export async function setSyncFields(
  object: string,
  fields: string[] | null,
): Promise<{ ok: true; added: string[] } | { ok: false; error: string }> {
  try {
    await assertAdmin();
    const db = createServiceClient();
    const { data: cfg } = await db.from("salesforce_sync_objects").select("mirror_table").eq("object", object).maybeSingle();
    const mirror = (cfg as { mirror_table: string } | null)?.mirror_table;
    if (!mirror) return { ok: false, error: "Unknown object." };

    let added: string[] = [];
    let chosen: string[] | null = null;
    if (fields) {
      for (const f of fields) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,120}$/.test(f)) return { ok: false, error: `Not a field name: ${f}` };
      }
      const { data: req } = await db.rpc("mirror_required_columns", { p_table: mirror });
      const required = (req as string[] | null) ?? [];
      chosen = [...new Set([...required, ...fields])].sort();
      const { data: newCols, error: colErr } = await db.rpc("ensure_mirror_columns", { p_table: mirror, p_columns: chosen });
      if (colErr) return { ok: false, error: colErr.message };
      added = (newCols as string[] | null) ?? [];
    }
    const { error } = await db.from("salesforce_sync_objects")
      .update({ fields: chosen, updated_at: new Date().toISOString(), updated_by: await currentMemberId() })
      .eq("object", object);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/integrations/salesforce");
    return { ok: true, added };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}
