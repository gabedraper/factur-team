"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
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

/**
 * Where a video file uploaded on the lesson editor goes.
 *
 * The bytes never pass through here. The browser is handed a one-off signed
 * upload URL and sends the file straight to Supabase Storage, because a
 * training recording is hundreds of megabytes and a server action body that
 * size would simply be refused -- the same reason resumes are uploaded that
 * way in components/talent/Documents.tsx.
 *
 * The bucket is public, and that is deliberate rather than lazy: the address is
 * stored on the lesson and the learner page plays it directly, so a signed read
 * URL would leave every uploaded lesson dead a few hours after it was made. The
 * alternative people were using was an unlisted YouTube upload, which is the
 * same "anyone with the link" trade with the recording on someone else's
 * platform.
 *
 * Created on first use rather than in a migration so there is nothing to run
 * before the button works.
 */
export async function lessonVideoUploadTarget(lessonId: string, fileName: string) {
  const perms = await myPermissions();
  if (!perms.has("lms.instruct") && !perms.has("lms.admin") && !perms.has("org.manage")) {
    return { success: false as const, error: "Forbidden: course authoring required" };
  }

  const bucket = "lesson-media";
  const service = createServiceClient();

  const { data: existing } = await service.storage.getBucket(bucket);
  if (!existing) {
    const { error } = await service.storage.createBucket(bucket, {
      public: true,
      allowedMimeTypes: ["video/*"],
    });
    // Another editor uploading at the same moment wins the race, and that is fine.
    if (error && !/exist/i.test(error.message)) {
      return { success: false as const, error: error.message };
    }
  }

  const safe = fileName.replace(/[^\w.\-]+/g, "_");
  const path = `${lessonId}/${Date.now()}-${safe}`;

  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return { success: false as const, error: error?.message ?? "Could not start the upload" };
  }

  const { data: pub } = service.storage.from(bucket).getPublicUrl(path);

  return {
    success: true as const,
    bucket,
    path: data.path,
    token: data.token,
    publicUrl: pub.publicUrl,
  };
}
