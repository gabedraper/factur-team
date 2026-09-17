"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { reconcileSalesforce } from "@/lib/salesforce/reconcile";

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
    revalidatePath("/settings/salesforce-sync");
    const d = r.deleted;
    return {
      ok: true,
      summary: `Checked. Removed ${d.opportunities} opportunities, ${d.quotes} quotes and ${d.orders} orders that Salesforce deleted.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The check failed." };
  }
}
