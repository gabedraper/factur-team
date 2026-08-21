"use server";

import { createClient } from "@/lib/supabase/server";
import { getCourseProgress } from "@/lib/progress";
import { issueCertificate } from "@/actions/certificates";

export async function markLessonComplete(
  lessonId: string,
  quizScore?: number
): Promise<{ progress: number; certificateIssued: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { progress: 0, certificateIssued: false, error: "Not authenticated" };
  }

  // Insert progress (upsert to handle duplicates)
  const { error: progressError } = await supabase
    .from("lesson_progress")
    .upsert(
      {
        user_id: user.id,
        lesson_id: lessonId,
        completed_at: new Date().toISOString(),
        quiz_score: quizScore ?? null,
      },
      { onConflict: "user_id,lesson_id" }
    );

  if (progressError) {
    return { progress: 0, certificateIssued: false, error: progressError.message };
  }

  // Find the course this lesson belongs to
  const { data: lessonData } = await supabase
    .from("lessons")
    .select("module_id, modules(course_id)")
    .eq("id", lessonId)
    .single();

  if (!lessonData) {
    return { progress: 0, certificateIssued: false };
  }

  const moduleData = (Array.isArray(lessonData.modules) ? lessonData.modules[0] : lessonData.modules) as { course_id: string } | null;
  if (!moduleData) {
    return { progress: 0, certificateIssued: false };
  }

  const courseId = moduleData.course_id;
  const progress = await getCourseProgress(supabase, user.id, courseId);

  let certificateIssued = false;

  if (progress === 100) {
    // Mark enrollment as complete
    await supabase
      .from("enrollments")
      .update({ completed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("course_id", courseId);

    // Issue certificate
    const certResult = await issueCertificate(user.id, courseId);
    certificateIssued = certResult.success && !certResult.alreadyExisted;
  }

  return { progress, certificateIssued };
}
