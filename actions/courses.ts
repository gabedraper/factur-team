"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getCoursesWithStats() {
  const supabase = createServiceClient();

  const [coursesRes, modulesRes, lessonsRes, enrollmentsRes, profilesRes] = await Promise.all([
    supabase.from("courses").select("id, title, is_published, instructor_id").order("title"),
    supabase.from("modules").select("id, course_id"),
    supabase.from("lessons").select("id, module_id"),
    supabase.from("enrollments").select("course_id, completed_at"),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const profiles: Record<string, string> = {};
  (profilesRes.data || []).forEach((p) => { profiles[p.id] = p.full_name; });

  // module_id → course_id
  const moduleMap: Record<string, string> = {};
  (modulesRes.data || []).forEach((m) => { moduleMap[m.id] = m.course_id; });

  // lesson count per course
  const lessonCount: Record<string, number> = {};
  (lessonsRes.data || []).forEach((l) => {
    const courseId = moduleMap[l.module_id];
    if (courseId) lessonCount[courseId] = (lessonCount[courseId] || 0) + 1;
  });

  // enrolled + completed per course
  const enrolledCount: Record<string, number> = {};
  const completedCount: Record<string, number> = {};
  (enrollmentsRes.data || []).forEach((e) => {
    enrolledCount[e.course_id] = (enrolledCount[e.course_id] || 0) + 1;
    if (e.completed_at) completedCount[e.course_id] = (completedCount[e.course_id] || 0) + 1;
  });

  return (coursesRes.data || []).map((c) => ({
    ...c,
    lessonCount: lessonCount[c.id] || 0,
    enrolledCount: enrolledCount[c.id] || 0,
    completedCount: completedCount[c.id] || 0,
    ownerName: c.instructor_id ? (profiles[c.instructor_id] || null) : null,
  }));
}

export async function createCourse(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const thumbnailUrl = formData.get("thumbnail_url") as string;

  if (!title) return { success: false, error: "Title is required" };

  const { data, error } = await supabase
    .from("courses")
    .insert({
      title,
      description,
      thumbnail_url: thumbnailUrl || null,
      instructor_id: user.id,
      is_published: false,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/instructor/courses");
  return { success: true, course: data };
}

export async function updateCourse(
  courseId: string,
  updates: {
    title?: string;
    description?: string;
    thumbnail_url?: string;
    is_published?: boolean;
    instructor_id?: string;
  }
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("courses")
    .update(updates)
    .eq("id", courseId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/instructor/courses/${courseId}`);
  return { success: true };
}

export async function deleteCourse(courseId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("courses")
    .delete()
    .eq("id", courseId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/instructor/courses");
  return { success: true };
}

export async function publishCourse(courseId: string, publish: boolean) {
  return updateCourse(courseId, { is_published: publish });
}
