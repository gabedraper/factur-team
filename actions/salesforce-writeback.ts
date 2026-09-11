"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions, currentMemberId } from "@/lib/org";
import { pushEdits, requeueStuck } from "@/lib/salesforce/writeback";

/*
 * The write-back's controls and its log.
 *
 * Everything here is org.manage only and goes through the service client: the
 * log has no insert or update policy at all, by design, so an audit trail
 * cannot be edited by the people it records.
 */

async function assertAdmin() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) throw new Error("Forbidden: org.manage required");
}

export type WritebackLogRow = {
  id: number;
  created_at: string;
  edit_id: string;
  member_id: string | null;
  opportunity_id: string;
  salesforce_id: string;
  field: string;
  sf_field: string;
  old_value: string | null;
  new_value: string | null;
  sf_before: string | null;
  sf_after: string | null;
  status: string;
  attempts: number;
  error: string | null;
  sent_at: string | null;
};

export type WritebackTester = { member_id: string; name: string; email: string };

export async function getWritebackState(status?: string): Promise<{
  enabled: boolean;
  testers: WritebackTester[];
  rows: WritebackLogRow[];
  counts: Record<string, number>;
}> {
  await assertAdmin();
  const db = createServiceClient();

  let logQuery = db
    .from("salesforce_writeback_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && status !== "all") logQuery = logQuery.eq("status", status);

  const [{ data: settings }, { data: testerRows }, { data: rows }, { data: all }] = await Promise.all([
    db.from("salesforce_writeback_settings").select("enabled").eq("id", true).maybeSingle(),
    db.from("salesforce_writeback_testers").select("member_id, org_members(full_name, email)"),
    logQuery,
    /* Small enough to count in one read while this is a test; a status tile
       that lies is worse than no tile. */
    db.from("salesforce_writeback_log").select("status").limit(5000),
  ]);

  const counts: Record<string, number> = {};
  for (const r of (all ?? []) as Array<{ status: string }>) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const testers = ((testerRows ?? []) as unknown as Array<{
    member_id: string;
    org_members: { full_name: string | null; email: string } | null;
  }>).map((t) => ({
    member_id: t.member_id,
    name: t.org_members?.full_name ?? t.org_members?.email ?? "Unknown",
    email: t.org_members?.email ?? "",
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    enabled: Boolean((settings as { enabled: boolean } | null)?.enabled),
    testers,
    rows: (rows ?? []) as WritebackLogRow[],
    counts,
  };
}

export async function setWritebackEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin();
    const db = createServiceClient();
    const { error } = await db
      .from("salesforce_writeback_settings")
      .update({ enabled, updated_at: new Date().toISOString(), updated_by: await currentMemberId() })
      .eq("id", true);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/salesforce-writeback");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change that." };
  }
}

export async function addWritebackTester(memberId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin();
    const db = createServiceClient();
    const { error } = await db
      .from("salesforce_writeback_testers")
      .upsert({ member_id: memberId, added_by: await currentMemberId() }, { onConflict: "member_id" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/salesforce-writeback");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that person." };
  }
}

export async function removeWritebackTester(memberId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin();
    const db = createServiceClient();
    const { error } = await db.from("salesforce_writeback_testers").delete().eq("member_id", memberId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/salesforce-writeback");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove that person." };
  }
}

/** Push whatever is waiting, now, without waiting for the sweep. */
export async function pushWritebackNow(): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  try {
    await assertAdmin();
    const requeued = await requeueStuck();
    const t = await pushEdits({ limit: 100 });
    revalidatePath("/settings/salesforce-writeback");
    return {
      ok: true,
      summary:
        `${t.pushed} pushed, ${t.verified} verified, ${t.mismatched} mismatched, ` +
        `${t.conflicts} conflicts, ${t.failed} failed` + (requeued ? `, ${requeued} requeued` : ""),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not push." };
  }
}
