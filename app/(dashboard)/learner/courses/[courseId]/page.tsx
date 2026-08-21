import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getCourseProgress } from "@/lib/progress";
import { getCourseGradientStyle } from "@/lib/course-colors";
import {
  ArrowLeft,
  Video,
  FileText,
  HelpCircle,
  File,
  CheckCircle,
  Circle,
  Clock,
} from "lucide-react";

const lessonTypeIcons: Record<string, React.ReactNode> = {
  video: <Video className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  quiz: <HelpCircle className="h-4 w-4" />,
  file: <File className="h-4 w-4" />,
};

interface Lesson {
  id: string;
  title: string;
  type: string;
  position: number;
  duration_minutes: number | null;
}

interface Module {
  id: string;
  title: string;
  position: number;
  lessons: Lesson[];
}

async function enrollAction(formData: FormData) {
  "use server";
  const courseId = formData.get("courseId") as string;
  const { createClient: createSC } = await import("@/lib/supabase/server");
  const sc = await createSC();
  const { data: { user } } = await sc.auth.getUser();
  if (user && courseId) {
    await sc.from("enrollments").upsert({ user_id: user.id, course_id: courseId }, { onConflict: "user_id,course_id" });
  }
  redirect(`/learner/courses/${courseId}`);
}

export default async function CourseOutlinePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const supabase = await createClient();

  const user = await getAuthedUser();

  if (!user) return null;

  const { data: course } = await supabase
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .single();

  if (!course) notFound();

  const { data: modulesData } = await supabase
    .from("modules")
    .select("*, lessons(*)")
    .eq("course_id", courseId)
    .order("position");

  const modules: Module[] = (modulesData || []).map((m) => ({
    ...m,
    lessons: (m.lessons || []).sort(
      (a: Lesson, b: Lesson) => a.position - b.position
    ),
  }));

  // Check enrollment
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("*")
    .eq("user_id", user.id)
    .eq("course_id", courseId)
    .single();

  const isEnrolled = !!enrollment;

  // Get completed lessons
  const allLessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));
  const { data: completedLessons } = isEnrolled
    ? await supabase
        .from("lesson_progress")
        .select("lesson_id")
        .eq("user_id", user.id)
        .in("lesson_id", allLessonIds.length > 0 ? allLessonIds : ["none"])
    : { data: [] };

  const completedIds = new Set(completedLessons?.map((p) => p.lesson_id) || []);
  const progress = isEnrolled
    ? await getCourseProgress(supabase, user.id, courseId)
    : 0;

  const totalDuration = modules
    .flatMap((m) => m.lessons)
    .reduce((sum, l) => sum + (l.duration_minutes || 0), 0);

  // Find first incomplete lesson for "continue" button
  let firstIncompleteLessonId: string | null = null;
  for (const mod of modules) {
    for (const lesson of mod.lessons) {
      if (!completedIds.has(lesson.id)) {
        firstIncompleteLessonId = lesson.id;
        break;
      }
    }
    if (firstIncompleteLessonId) break;
  }

  return (
    <div className="p-8 max-w-4xl pb-24">
      <Button variant="ghost" asChild className="mb-6 -ml-2">
        <Link href="/learner">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Learning
        </Link>
      </Button>

      {/* Course header */}
      <div className="mb-8">
        <div className="flex items-start gap-6">
          <div
            className="w-32 h-20 rounded-lg flex-shrink-0"
            style={
              course.thumbnail_url
                ? { backgroundImage: `url(${course.thumbnail_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                : getCourseGradientStyle(courseId)
            }
          />
          <div className="flex-1">
            <h1 className="text-3xl font-bold">{course.title}</h1>
            {course.description && (
              <p className="text-muted-foreground mt-2">{course.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
              {totalDuration > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {totalDuration} min
                </span>
              )}
              <span>
                {allLessonIds.length} lessons
              </span>
            </div>
          </div>
        </div>

        {isEnrolled && (
          <div className="mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Course Progress</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-3" />
          </div>
        )}

        <div className="mt-4 flex gap-3">
          {!isEnrolled ? (
            <form action={enrollAction}>
              <input type="hidden" name="courseId" value={courseId} />
              <Button type="submit">Enroll Now</Button>
            </form>
          ) : (
            <>
              {firstIncompleteLessonId && (
                <Button asChild>
                  <Link
                    href={`/learner/courses/${courseId}/lessons/${firstIncompleteLessonId}`}
                  >
                    {progress > 0 ? "Continue Course" : "Start Course"}
                  </Link>
                </Button>
              )}
              {progress === 100 && (
                <Button variant="outline" asChild>
                  <Link href="/learner/certificates">View Certificate</Link>
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Course outline */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Course Content</h2>
        {modules.map((mod, mIdx) => (
          <Card key={mod.id}>
            <CardHeader className="py-3">
              <CardTitle className="text-base">
                Module {mIdx + 1}: {mod.title}
              </CardTitle>
              <CardDescription>
                {mod.lessons.length} lesson{mod.lessons.length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="space-y-2">
                {mod.lessons.map((lesson, lIdx) => {
                  const isCompleted = completedIds.has(lesson.id);
                  return (
                    <div
                      key={lesson.id}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50"
                    >
                      {isCompleted ? (
                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="text-muted-foreground">
                        {lessonTypeIcons[lesson.type]}
                      </span>
                      <span className="flex-1 text-sm">
                        {lIdx + 1}. {lesson.title}
                      </span>
                      <div className="flex items-center gap-2">
                        {lesson.duration_minutes && (
                          <span className="text-xs text-muted-foreground">
                            {lesson.duration_minutes} min
                          </span>
                        )}
                        <Badge variant="outline" className="text-xs capitalize">
                          {lesson.type}
                        </Badge>
                        {isEnrolled && (
                          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                            <Link
                              href={`/learner/courses/${courseId}/lessons/${lesson.id}`}
                            >
                              {isCompleted ? "Review" : "Start"}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
        {modules.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No content available yet.
          </div>
        )}
      </div>

      {/* Sticky bottom progress bar */}
      {isEnrolled && allLessonIds.length > 0 && (
        <div className="fixed bottom-0 left-64 right-0 bg-background border-t px-8 py-3 z-10">
          <div className="max-w-4xl flex items-center gap-4">
            <span className="text-sm text-muted-foreground shrink-0">Course Progress</span>
            <div className="flex-1">
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <span className="text-sm font-semibold shrink-0">{progress}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
