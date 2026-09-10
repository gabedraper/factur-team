"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId, myPermissions } from "@/lib/org";
import { canEdit, fieldValues, getDashboard, getReport, runSpec } from "@/lib/reporting/data";
import {
  ChartSchema, SpecSchema, TileSchema,
  type Chart, type ReportResult, type Spec,
} from "@/lib/reporting/spec";

/**
 * Writes behind the report builder, and the one read the builder makes
 * while somebody is still typing: the live preview.
 *
 * Every spec is parsed with the schema before it goes anywhere. The
 * database checks the names again; this checks the shape, so a malformed
 * call gets a sentence back instead of a Postgres error.
 */

type Result = { success: boolean; error?: string };

export async function previewReport(
  input: unknown,
): Promise<{ ok: true; result: ReportResult } | { ok: false; error: string }> {
  const parsed = SpecSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That report is not well formed." };
  try {
    return { ok: true, result: await runSpec(parsed.data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The report did not run." };
  }
}

export async function lookupValues(input: {
  object: string; field: string; lookup?: string | null; query?: string;
}): Promise<{ value: string; n: number }[]> {
  try {
    return await fieldValues(input.object, input.field, input.lookup ?? null, input.query ?? "");
  } catch {
    // A field with no value list is not an error the picker needs to show;
    // the box stays a plain text box.
    return [];
  }
}

const SaveReport = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(1, "A report needs a name.").max(120),
  description: z.string().trim().max(500).nullish(),
  shared: z.boolean(),
  spec: SpecSchema,
  chart: ChartSchema.nullish(),
});

export async function saveReport(input: unknown): Promise<Result & { id?: string }> {
  const parsed = SaveReport.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "That report is not well formed." };
  }
  const memberId = await currentMemberId();
  if (!memberId) return { success: false, error: "No member record for you." };

  const db = await createClient();
  const v = parsed.data;
  const row = {
    name: v.name,
    description: v.description || null,
    shared: v.shared,
    spec: v.spec as Spec,
    chart: (v.chart ?? null) as Chart | null,
    updated_at: new Date().toISOString(),
  };

  if (v.id) {
    const existing = await getReport(v.id);
    if (!existing) return { success: false, error: "That report no longer exists." };
    if (!canEdit(existing, memberId, await myPermissions())) {
      return { success: false, error: "Only the author can change this report." };
    }
    const { error } = await db.from("reports").update(row).eq("id", v.id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/reports", "layout");
    return { success: true, id: v.id };
  }

  const { data, error } = await db
    .from("reports")
    .insert({ ...row, owner_member_id: memberId })
    .select("id")
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  revalidatePath("/reports", "layout");
  return { success: true, id: (data as { id: string } | null)?.id };
}

export async function deleteReport(id: string): Promise<Result> {
  const db = await createClient();
  // Row security decides; a delete of something you may not touch removes
  // nothing and reports nothing, so the count is checked to say so.
  const { error, count } = await db.from("reports").delete({ count: "exact" }).eq("id", id);
  if (error) return { success: false, error: error.message };
  if (!count) return { success: false, error: "Only the author can delete this report." };
  revalidatePath("/reports", "layout");
  return { success: true };
}

const SaveDashboard = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(1, "A dashboard needs a name.").max(120),
  description: z.string().trim().max(500).nullish(),
  shared: z.boolean(),
  tiles: z.array(TileSchema).max(24),
});

export async function saveDashboard(input: unknown): Promise<Result & { id?: string }> {
  const parsed = SaveDashboard.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "That dashboard is not well formed." };
  }
  const memberId = await currentMemberId();
  if (!memberId) return { success: false, error: "No member record for you." };

  const db = await createClient();
  const v = parsed.data;
  const row = {
    name: v.name,
    description: v.description || null,
    shared: v.shared,
    tiles: v.tiles,
    updated_at: new Date().toISOString(),
  };

  if (v.id) {
    const existing = await getDashboard(v.id);
    if (!existing) return { success: false, error: "That dashboard no longer exists." };
    if (!canEdit(existing, memberId, await myPermissions())) {
      return { success: false, error: "Only the author can change this dashboard." };
    }
    const { error } = await db.from("dashboards").update(row).eq("id", v.id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/reports", "layout");
    return { success: true, id: v.id };
  }

  const { data, error } = await db
    .from("dashboards")
    .insert({ ...row, owner_member_id: memberId })
    .select("id")
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  revalidatePath("/reports", "layout");
  return { success: true, id: (data as { id: string } | null)?.id };
}

export async function deleteDashboard(id: string): Promise<Result> {
  const db = await createClient();
  const { error, count } = await db.from("dashboards").delete({ count: "exact" }).eq("id", id);
  if (error) return { success: false, error: error.message };
  if (!count) return { success: false, error: "Only the author can delete this dashboard." };
  revalidatePath("/reports", "layout");
  return { success: true };
}
