"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getEnrollmentsAdmin() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("enrollments")
    .select(`
      id, enrolled_at, completed_at, deadline,
      profiles!enrollments_user_id_fkey(id, full_name, role),
      courses!enrollments_course_id_fkey(id, title)
    `)
    .order("enrolled_at", { ascending: false });
  return data || [];
}

export async function adminEnrollUser(formData: FormData) {
  const supabase = createServiceClient();
  const userId = formData.get("user_id") as string;
  const courseId = formData.get("course_id") as string;
  const deadline = formData.get("deadline") as string;
  if (!userId || !courseId) return { success: false, error: "Missing fields" };
  const { error } = await supabase
    .from("enrollments")
    .upsert({ user_id: userId, course_id: courseId, deadline: deadline || null }, { onConflict: "user_id,course_id" });
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/enrollments");
  return { success: true };
}

export async function removeEnrollment(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("enrollments").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/enrollments");
  return { success: true };
}

export async function updateEnrollmentDeadline(id: string, deadline: string | null) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("enrollments").update({ deadline: deadline || null }).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/enrollments");
  return { success: true };
}

export async function enrollInCourse(courseId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase.from("enrollments").insert({
    user_id: user.id,
    course_id: courseId,
  });

  if (error && error.code !== "23505") {
    // 23505 = unique violation (already enrolled)
    return { success: false, error: error.message };
  }

  revalidatePath("/learner");
  return { success: true };
}

export async function unenrollFromCourse(courseId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("user_id", user.id)
    .eq("course_id", courseId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/learner");
  return { success: true };
}
