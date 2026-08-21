"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getRoleCoursesAll() {
  const supabase = createServiceClient();

  const [{ data: roleCourses }, { data: courses }, { data: roles }] = await Promise.all([
    supabase
      .from("role_courses")
      .select("*, courses(id, title)")
      .order("created_at"),
    supabase
      .from("courses")
      .select("id, title")
      .order("title"),
    supabase
      .from("org_roles")
      .select("id, name, service_id")
      .eq("active", true)
      .order("name"),
  ]);

  return {
    roleCourses: (roleCourses || []) as any[],
    // The roles defined in Settings -- the same list everything else uses.
    roles: (roles || []) as { id: string; name: string; service_id: string | null }[],
    courses: (courses || []) as { id: string; title: string }[],
  };
}

export async function addRoleCourse(roleId: string, courseId: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("role_courses")
    .insert({ role_id: roleId, course_id: courseId });

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/role-training");
  return { success: true };
}

export async function removeRoleCourse(id: string) {
  const supabase = createServiceClient();
  await supabase.from("role_courses").delete().eq("id", id);
  revalidatePath("/admin/role-training");
  return { success: true };
}
