"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { revalidatePath } from "next/cache";

export async function getUsersWithEmails() {
  await requireAdmin();
  const supabase = createServiceClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: authUsers } = await supabase.auth.admin.listUsers();

  const emailMap: Record<string, string> = {};
  authUsers?.users?.forEach((u) => {
    emailMap[u.id] = u.email || "";
  });

  return (profiles || []).map((p) => ({ ...p, email: emailMap[p.id] || "" }));
}

// With Google sign-in there is nothing to invite someone to -- anyone with a
// Factur Google account can already get in. What an admin actually needs is to
// decide the role they land on. handle_new_user() reads lms_initial_roles at
// first sign-in; if the person is already here, apply it to their profile too.
export async function preassignRole(email: string, role: string) {
  await requireAdmin();
  const supabase = createServiceClient();
  const normalized = email.trim().toLowerCase();

  const domain = normalized.split("@")[1];
  if (domain !== "bethefactur.com" && domain !== "facturmfg.com") {
    return {
      success: false,
      error: "Only @bethefactur.com and @facturmfg.com addresses can sign in.",
    };
  }

  const { error } = await supabase
    .from("lms_initial_roles")
    .upsert({ email: normalized, role }, { onConflict: "email" });

  if (error) return { success: false, error: error.message };

  const { data: existing } = await supabase.auth.admin.listUsers();
  const already = existing?.users?.find(
    (u) => u.email?.toLowerCase() === normalized
  );
  if (already) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", already.id);
    if (profileError) return { success: false, error: profileError.message };
  }

  revalidatePath("/admin/users");
  return { success: true, alreadySignedUp: Boolean(already) };
}

export async function updateUserRole(userId: string, role: string) {
  await requireAdmin();
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/users");
  return { success: true };
}

export async function deleteUser(userId: string) {
  await requireAdmin();
  const supabase = createServiceClient();

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/users");
  return { success: true };
}
