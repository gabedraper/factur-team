"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type LessonType = "video" | "text" | "quiz" | "file";

/*
 * Where a video uploaded into a lesson lives.
 *
 * The same shape as the talent bucket: private, with every play going through a
 * fresh signed URL, because a recorded internal call is not something to leave
 * sitting at a permanent public address. The file goes from the browser straight
 * into storage -- a half-gigabyte recording through a server action body would
 * be refused -- so the server's only job is to hand out a one-shot upload
 * ticket and, later, a link to watch.
 */
const VIDEO_BUCKET = "lesson-videos";

export async function lessonVideoUploadTicket(
  lessonId: string,
  fileName: string
) {
  const supabase = await createClient();
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id")
    .eq("id", lessonId)
    .single();

  if (!lesson) return { success: false as const, error: "Lesson not found" };

  const admin = createServiceClient();

  // Made on first use. Nothing else in the app uploads video, so "already
  // exists" is the normal answer from the second recording onwards.
  await admin.storage.createBucket(VIDEO_BUCKET, {
    public: false,
    fileSizeLimit: 2147483648,
    allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
  });

  const safe = fileName.replace(/[^\w.\-]+/g, "_");
  const path = `${lessonId}/${Date.now()}-${safe}`;

  const { data, error } = await admin.storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(path);

  if (error) return { success: false as const, error: error.message };

  return { success: true as const, bucket: VIDEO_BUCKET, path, token: data.token };
}

export async function lessonVideoUrl(lessonId: string, path: string) {
  const supabase = await createClient();
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id")
    .eq("id", lessonId)
    .single();

  // The path is checked against the lesson it was asked for, so a signed link
  // to one lesson's recording cannot be talked out of another lesson's folder.
  if (!lesson || !path.startsWith(`${lessonId}/`)) {
    return { success: false as const, error: "Video not found" };
  }

  const { data, error } = await createServiceClient()
    .storage.from(VIDEO_BUCKET)
    .createSignedUrl(path, 3600);

  if (error || !data) {
    return { success: false as const, error: error?.message || "Video not found" };
  }

  return { success: true as const, url: data.signedUrl };
}

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

export async function reorderLessons(
  moduleId: string,
  courseId: string,
  lessonIds: string[]
) {
  const supabase = await createClient();

  // Positions are rewritten from scratch off the order handed in, so gaps left
  // by earlier deletes close up and every lesson lands on its own number.
  for (let i = 0; i < lessonIds.length; i++) {
    const { error } = await supabase
      .from("lessons")
      .update({ position: i })
      .eq("id", lessonIds[i])
      .eq("module_id", moduleId);

    if (error) return { success: false, error: error.message };
  }

  revalidatePath(`/instructor/courses/${courseId}`);
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
