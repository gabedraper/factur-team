"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import { assertTalent } from "@/lib/talent/access";

/**
 * The settings half: workflows and their stages, templates, activity types,
 * custom fields, stage automations, and the integration register.
 *
 * All of it needs `talent.admin`, because every one of these changes how the
 * system behaves for everybody -- renaming a stage moves every board that uses
 * that workflow.
 */

async function ctx() {
  await assertTalent("admin");
  return { supabase: await createClient(), me: await currentMemberId() };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveSettings(patch: {
  agency_name?: string;
  careers_page_enabled?: boolean;
  careers_page_heading?: string;
  careers_page_intro?: string | null;
  careers_apply_email?: string | null;
  default_workflow_id?: string | null;
  default_guarantee_days?: number;
  outreach_mode?: "semi" | "full";
  duplicate_check_on_add?: boolean;
}) {
  const { supabase, me } = await ctx();
  const { error } = await supabase
    .from("tal_settings")
    .update({ ...patch, updated_by: me })
    .eq("id", true);
  if (error) throw new Error(`Could not save settings: ${error.message}`);
  revalidatePath("/settings/talent");
  revalidatePath("/careers");
}

// ---------------------------------------------------------------------------
// Workflows and stages
// ---------------------------------------------------------------------------

export async function saveWorkflow(input: {
  id?: string; name: string; description?: string | null; is_default?: boolean; active?: boolean;
}) {
  const { supabase } = await ctx();
  if (!input.name?.trim()) throw new Error("A workflow needs a name");

  const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Only one workflow may be the default, and the unique index says so -- the
  // old one has to be stood down before the new one is raised.
  if (input.is_default) {
    await supabase.from("tal_workflows").update({ is_default: false }).eq("is_default", true);
  }

  const row = {
    name: input.name.trim(),
    description: input.description ?? null,
    is_default: input.is_default ?? false,
    active: input.active ?? true,
  };
  const { data, error } = input.id
    ? await supabase.from("tal_workflows").update(row).eq("id", input.id).select("id").single()
    : await supabase.from("tal_workflows").insert({ ...row, slug }).select("id").single();
  if (error) throw new Error(`Could not save that workflow: ${error.message}`);

  revalidatePath("/settings/talent");
  return (data as { id: string }).id;
}

export async function saveStage(input: {
  id?: string; workflow_id: string; name: string; kind?: string;
  position?: number; color?: string; is_terminal?: boolean; counts_as_progression?: boolean;
}) {
  const { supabase } = await ctx();
  if (!input.name?.trim()) throw new Error("A stage needs a name");

  let position = input.position;
  if (position === undefined) {
    const { data } = await supabase
      .from("tal_workflow_stages").select("position")
      .eq("workflow_id", input.workflow_id).order("position", { ascending: false })
      .limit(1).maybeSingle();
    position = ((data as { position: number } | null)?.position ?? -1) + 1;
  }

  const row = {
    workflow_id: input.workflow_id,
    name: input.name.trim(),
    kind: input.kind ?? "other",
    position,
    color: input.color ?? "slate",
    is_terminal: input.is_terminal ?? false,
    counts_as_progression: input.counts_as_progression ?? true,
  };
  const { error } = input.id
    ? await supabase.from("tal_workflow_stages").update(row).eq("id", input.id)
    : await supabase.from("tal_workflow_stages").insert(row);
  if (error) throw new Error(`Could not save that stage: ${error.message}`);
  revalidatePath("/settings/talent");
}

export async function reorderStages(workflowId: string, orderedIds: string[]) {
  const { supabase } = await ctx();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("tal_workflow_stages").update({ position: i }).eq("id", id))
  );
  revalidatePath("/settings/talent");
}

/**
 * Removing a stage is refused while anyone is standing in it. Deleting it
 * anyway would set those candidates' stage to null and drop them off every
 * board without saying so.
 */
export async function deleteStage(stageId: string) {
  const { supabase } = await ctx();
  const { count } = await supabase
    .from("tal_candidates").select("id", { count: "exact", head: true }).eq("stage_id", stageId);
  if (count) {
    throw new Error(`${count} candidate${count === 1 ? " is" : "s are"} in that stage — move them first`);
  }
  await supabase.from("tal_workflow_stages").delete().eq("id", stageId);
  revalidatePath("/settings/talent");
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function saveNoteTemplate(input: {
  id?: string; name: string; scope?: string; body?: string; active?: boolean;
}) {
  const { supabase, me } = await ctx();
  const row = {
    name: input.name.trim(),
    scope: input.scope ?? "person",
    body: input.body ?? "",
    active: input.active ?? true,
  };
  const { error } = input.id
    ? await supabase.from("tal_note_templates").update(row).eq("id", input.id)
    : await supabase.from("tal_note_templates").insert({ ...row, created_by: me });
  if (error) throw new Error(`Could not save that template: ${error.message}`);
  revalidatePath("/settings/talent");
}

export async function saveEmailTemplate(input: {
  id?: string; name: string; audience?: string; subject?: string; body?: string; active?: boolean;
}) {
  const { supabase, me } = await ctx();
  const row = {
    name: input.name.trim(),
    audience: input.audience ?? "candidate",
    subject: input.subject ?? "",
    body: input.body ?? "",
    active: input.active ?? true,
    merge_fields: ["{{first_name}}", "{{name}}", "{{title}}", "{{company}}", "{{job_title}}"],
  };
  const { error } = input.id
    ? await supabase.from("tal_email_templates").update(row).eq("id", input.id)
    : await supabase.from("tal_email_templates").insert({ ...row, created_by: me });
  if (error) throw new Error(`Could not save that template: ${error.message}`);
  revalidatePath("/settings/talent");
}

export async function deleteTemplate(kind: "note" | "email", id: string) {
  const { supabase } = await ctx();
  await supabase.from(kind === "note" ? "tal_note_templates" : "tal_email_templates")
    .delete().eq("id", id);
  revalidatePath("/settings/talent");
}

export async function saveScorecardTemplate(input: {
  id?: string;
  name: string;
  criteria: { key: string; label: string; description?: string }[];
  active?: boolean;
}) {
  const { supabase, me } = await ctx();
  const row = { name: input.name.trim(), criteria: input.criteria, active: input.active ?? true };
  const { error } = input.id
    ? await supabase.from("tal_scorecard_templates").update(row).eq("id", input.id)
    : await supabase.from("tal_scorecard_templates").insert({ ...row, created_by: me });
  if (error) throw new Error(`Could not save that scorecard: ${error.message}`);
  revalidatePath("/settings/talent");
}

// ---------------------------------------------------------------------------
// Activity types
// ---------------------------------------------------------------------------

export async function saveActivityType(input: {
  id?: string; name: string; category?: string;
  counts_as_progression?: boolean; color?: string; active?: boolean;
}) {
  const { supabase } = await ctx();
  const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const row = {
    name: input.name.trim(),
    category: input.category ?? "note",
    counts_as_progression: input.counts_as_progression ?? false,
    color: input.color ?? "slate",
    active: input.active ?? true,
  };
  const { error } = input.id
    ? await supabase.from("tal_activity_types").update(row).eq("id", input.id)
    : await supabase.from("tal_activity_types").insert({ ...row, slug });
  if (error) throw new Error(`Could not save that activity type: ${error.message}`);
  revalidatePath("/settings/talent");
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export async function saveDynamicField(input: {
  id?: string; entity: string; key?: string; label: string; field_type?: string;
  options?: string[]; help_text?: string | null; required?: boolean; active?: boolean;
}) {
  const { supabase } = await ctx();
  const key = input.key
    ?? input.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const row = {
    entity: input.entity,
    label: input.label.trim(),
    field_type: input.field_type ?? "text",
    options: input.options ?? [],
    help_text: input.help_text ?? null,
    required: input.required ?? false,
    active: input.active ?? true,
  };
  const { error } = input.id
    ? await supabase.from("tal_dynamic_fields").update(row).eq("id", input.id)
    : await supabase.from("tal_dynamic_fields").insert({ ...row, key });
  if (error) {
    if (error.code === "23505") throw new Error("A field with that name already exists here");
    throw new Error(`Could not save that field: ${error.message}`);
  }
  revalidatePath("/settings/talent");
}

export async function setDynamicValue(fieldId: string, entityId: string, value: unknown) {
  await assertTalent("recruit");
  const supabase = await createClient();
  const me = await currentMemberId();
  const { error } = await supabase
    .from("tal_dynamic_values")
    .upsert({ field_id: fieldId, entity_id: entityId, value, updated_by: me });
  if (error) throw new Error(`Could not save: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Stage automations
// ---------------------------------------------------------------------------

export async function saveAutomation(input: {
  id?: string; workflow_id: string; stage_id: string; trigger?: string;
  action: string; config?: Record<string, unknown>; active?: boolean;
}) {
  const { supabase, me } = await ctx();
  const row = {
    workflow_id: input.workflow_id,
    stage_id: input.stage_id,
    trigger: input.trigger ?? "enter",
    action: input.action,
    config: input.config ?? {},
    active: input.active ?? false,
  };
  const { error } = input.id
    ? await supabase.from("tal_stage_automations").update(row).eq("id", input.id)
    : await supabase.from("tal_stage_automations").insert({ ...row, created_by: me });
  if (error) throw new Error(`Could not save that automation: ${error.message}`);
  revalidatePath("/settings/talent");
}

export async function deleteAutomation(id: string) {
  const { supabase } = await ctx();
  await supabase.from("tal_stage_automations").delete().eq("id", id);
  revalidatePath("/settings/talent");
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

/**
 * Records that an outside service has been wired up, or that it has not.
 *
 * No credential is written here. This row is the switch the features read to
 * decide between working and explaining themselves; the key itself belongs in
 * an environment variable, where it is not one SQL injection away from being
 * read out of a table.
 */
export async function setIntegrationStatus(
  slug: string,
  status: "not_connected" | "connected" | "error" | "disabled",
  config?: Record<string, unknown>,
  note?: string | null
) {
  const { supabase, me } = await ctx();

  const forbidden = ["key", "secret", "token", "password", "credential"];
  for (const k of Object.keys(config ?? {})) {
    if (forbidden.some((f) => k.toLowerCase().includes(f))) {
      throw new Error(`${k} looks like a secret — those belong in an environment variable, not here`);
    }
  }

  const { error } = await supabase
    .from("tal_integrations")
    .update({
      status,
      config: config ?? {},
      last_error: note ?? null,
      connected_at: status === "connected" ? new Date().toISOString() : null,
      connected_by: status === "connected" ? me : null,
      updated_at: new Date().toISOString(),
    })
    .eq("slug", slug);
  if (error) throw new Error(`Could not update that: ${error.message}`);
  revalidatePath("/settings/talent");
  revalidatePath("/talent");
}
