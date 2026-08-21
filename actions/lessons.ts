"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type LessonType = "video" | "text" | "quiz" | "file";

export async function createLesson(
  moduleId: string,
  courseId: string,
  data: {
    title: string;
    type: LessonType;
    content?: Record<string, unknown>;
    duration_minutes?: number;
  }
) {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("lessons")
    .select("position")
    .eq("module_id", moduleId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition =
    existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const { data: lesson, error } = await supabase
    .from("lessons")
    .insert({
      module_id: moduleId,
      title: data.title,
      type: data.type,
      content: data.content ?? null,
      duration_minutes: data.duration_minutes ?? null,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath(`/instructor/courses/${courseId}`);
  return { success: true, lesson };
}

export async function updateLesson(
  lessonId: string,
  courseId: string,
  updates: {
    title?: string;
    type?: LessonType;
    content?: Record<string, unknown>;
    duration_minutes?: number;
    owner_id?: string | null;
  }
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("lessons")
    .update(updates)
    .eq("id", lessonId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/instructor/courses/${courseId}`);
  revalidatePath(`/instructor/courses/${courseId}/lessons/${lessonId}/edit`);
  return { success: true };
}

export async function deleteLesson(lessonId: string, courseId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("lessons")
    .delete()
    .eq("id", lessonId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/instructor/courses/${courseId}`);
  return { success: true };
}
