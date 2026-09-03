"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createModule(courseId: string, title: string) {
  const supabase = await createClient();

  // Get next position
  const { data: existing } = await supabase
    .from("modules")
    .select("position")
    .eq("course_id", courseId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const { data, error } = await supabase
    .from("modules")
    .insert({ course_id: courseId, title, position: nextPosition })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath(`/instructor/courses/${courseId}`);
  return { success: true, module: data };
}

export async function updateModule(
  moduleId: string,
  title: string,
  courseId: string
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("modules")
    .update({ title })
    .eq("id", moduleId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/instructor/courses/${courseId}`);
  return { success: true };
}

export async function reorderModules(courseId: string, moduleIds: string[]) {
  const supabase = await createClient();

  // Positions are rewritten from scratch off the order handed in, so gaps left
  // by earlier deletes close up and every module lands on its own number.
  for (let i = 0; i < moduleIds.length; i++) {
    const { error } = await supabase
      .from("modules")
      .update({ position: i })
      .eq("id", moduleIds[i])
      .eq("course_id", courseId);

    if (error) return { success: false, error: error.message };
  }

  revalidatePath(`/instructor/courses/${courseId}`);
  return { success: true };
}

export async function deleteModule(moduleId: string, courseId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("modules")
    .delete()
    .eq("id", moduleId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/instructor/courses/${courseId}`);
  return { success: true };
}
