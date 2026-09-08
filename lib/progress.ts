import type { SupabaseClient } from "@supabase/supabase-js";

// A lesson is empty when nothing was ever put in it -- no video, no words, no
// file, no questions. Learners are not expected to complete these, so they stay
// out of the outline and out of the progress maths.
export function isLessonEmpty(lesson: {
  type: string;
  content: unknown;
}): boolean {
  const content = (lesson.content || {}) as {
    url?: string;
    body?: string;
    fileUrl?: string;
    questions?: unknown[];
  };

  switch (lesson.type) {
    case "video":
      return !content.url?.trim();
    case "file":
      return !content.fileUrl?.trim();
    case "quiz":
      return !content.questions?.length;
    case "text": {
      const body = content.body || "";
      // The editor saves markup even when there are no words in it, so strip the
      // tags -- but keep a lesson whose body is only an image or an embed.
      if (/<(img|iframe|video)\b/i.test(body)) return false;
      return (
        body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0
      );
    }
    default:
      return false;
  }
}

export async function getCourseProgress(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<number> {
  try {
    // Get all lessons for the course in one query (joined through modules)
    const { data: lessons, error: lessonsError } = await supabase
      .from("lessons")
      .select("id, type, content, modules!inner(course_id)")
      .eq("modules.course_id", courseId);

    if (lessonsError || !lessons || lessons.length === 0) return 0;

    const lessonIds = lessons
      .filter((l) => !isLessonEmpty(l))
      .map((l) => l.id);

    if (lessonIds.length === 0) return 0;

    // Get completed lessons for user
    const { data: progress, error: progressError } = await supabase
      .from("lesson_progress")
      .select("id")
      .eq("user_id", userId)
      .in("lesson_id", lessonIds);

    if (progressError) return 0;

    const completed = progress?.length ?? 0;
    const total = lessonIds.length;

    return Math.round((completed / total) * 100);
  } catch {
    return 0;
  }
}
