import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Eye, Pencil, FileText } from "lucide-react";
import { getCourseGradientStyle } from "@/lib/course-colors";

export default async function AdminCourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const supabase = createServiceClient();

  const { data: course } = await supabase
    .from("courses")
    .select("*, profiles(full_name)")
    .eq("id", (await params).courseId)
    .single();

  if (!course) notFound();

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, position")
    .eq("course_id", (await params).courseId)
    .order("position");

  const moduleIds = (modules || []).map((m) => m.id);

  const { data: lessons } = moduleIds.length
    ? await supabase
        .from("lessons")
        .select("id, title, type, position, module_id")
        .in("module_id", moduleIds)
        .order("position")
    : { data: [] };

  const lessonsByModule: Record<string, any[]> = {};
  (lessons || []).forEach((l) => {
    if (!lessonsByModule[l.module_id]) lessonsByModule[l.module_id] = [];
    lessonsByModule[l.module_id].push(l);
  });

  const totalLessons = lessons?.length || 0;

  return (
    <div className="p-8 max-w-4xl">
      {/* Back */}
      <Link
        href="/admin/courses"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        All Courses
      </Link>

      {/* Course hero */}
      <div className="h-40 rounded-xl mb-8 flex items-end p-6" style={getCourseGradientStyle((await params).courseId)}>
        <h1 className="text-3xl font-bold text-white drop-shadow">{course.title}</h1>
      </div>

      {/* Course header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{course.title}</h1>
            <Badge variant={course.is_published ? "default" : "secondary"}>
              {course.is_published ? "Published" : "Draft"}
            </Badge>
          </div>
          {course.description && (
            <p className="text-muted-foreground">{course.description}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            {totalLessons} lesson{totalLessons !== 1 ? "s" : ""}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/instructor/courses/${course.id}`}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit Course
          </Link>
        </Button>
      </div>

      {/* Lessons */}
      {totalLessons === 0 ? (
        <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No lessons yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(modules || []).map((module) => {
            const moduleLessons = lessonsByModule[module.id] || [];
            if (moduleLessons.length === 0) return null;
            return (
              <div key={module.id}>
                {modules && modules.length > 1 && (
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {module.title}
                  </h2>
                )}
                <div className="border rounded-lg divide-y overflow-hidden">
                  {moduleLessons.map((lesson, i) => (
                    <div
                      key={lesson.id}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-muted-foreground w-5 shrink-0">
                          {i + 1}
                        </span>
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{lesson.title}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <Badge variant="outline" className="text-xs capitalize">
                          {lesson.type}
                        </Badge>
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                          <Link
                            href={`/learner/courses/${course.id}/lessons/${lesson.id}?preview=true`}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Preview
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
