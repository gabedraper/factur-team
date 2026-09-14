import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Eye, Pencil, FileText } from "lucide-react";
import { getCourseGradientStyle } from "@/lib/course-colors";
import { PageHeader } from "@/components/ui/page-header";
import { everyRow } from "@/lib/supabase/every-row.mjs";
import { Surface } from "@/components/ui/surface";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";

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
  const lessonIds = (lessons || []).map((l) => l.id);

  // Who is signed up and how far each of them has got. "Who all finished the
  // Pipeline Management modules" had no screen that answered it, so the only
  // way to answer it was to read the completion records by hand.
  const { data: enrollments, error: enrollmentsError } = await supabase
    .from("enrollments")
    .select("id, user_id, completed_at, profiles(full_name)")
    .eq("course_id", (await params).courseId);

  // Every completion for this course's lessons. Enrollees times lessons passes
  // the thousand-row cap on a course this size, and a truncated read would
  // report people as having done less than they have.
  let completions: { user_id: string | null; completed_at: string | null }[] = [];
  let rosterError: string | null = enrollmentsError?.message ?? null;
  try {
    if (lessonIds.length) {
      completions = await everyRow(() =>
        supabase
          .from("lesson_progress")
          .select("user_id, completed_at")
          .in("lesson_id", lessonIds)
          // (lesson_id, user_id) is unique, so the order is total and no row
          // can repeat or vanish between pages.
          .order("lesson_id")
          .order("user_id")
      );
    }
  } catch (err) {
    rosterError = err instanceof Error ? err.message : "Couldn't read lesson completions.";
  }

  const doneByUser = new Map<string, { count: number; last: string | null }>();
  completions.forEach((c) => {
    if (!c.user_id) return;
    const done = doneByUser.get(c.user_id) || { count: 0, last: null };
    done.count += 1;
    if (c.completed_at && (!done.last || c.completed_at > done.last)) {
      done.last = c.completed_at;
    }
    doneByUser.set(c.user_id, done);
  });

  // Least done first, so the people who have started nothing are the rows you
  // land on rather than rows you have to scroll for.
  const roster = (enrollments || [])
    .map((e) => {
      // A to-one embed arrives as one row, whatever the generated type says.
      const profile = e.profiles as unknown as { full_name: string | null } | null;
      const done = doneByUser.get(e.user_id ?? "") || { count: 0, last: null };
      return {
        id: e.id,
        // A profile carries no email, so the name is all there is to fall
        // back from.
        name: profile?.full_name || "Unknown",
        completedAt: e.completed_at as string | null,
        done: done.count,
        last: done.last,
      };
    })
    .sort((a, b) => a.done - b.done || a.name.localeCompare(b.name));

  const finishedAll =
    totalLessons > 0 ? roster.filter((r) => r.done >= totalLessons).length : 0;
  const notStarted = roster.filter((r) => r.done === 0).length;

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
        {/* design-ok: title printed over the cover image */}
        <h1 className="text-3xl font-bold text-white drop-shadow">{course.title}</h1>
      </div>

      {/* Course header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <PageHeader
            title={course.title}
            actions={<Badge variant={course.is_published ? "default" : "secondary"}>
              {course.is_published ? "Published" : "Draft"}
            </Badge>}
            className="mb-1"
          />
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

      {/* Who has finished */}
      <div className="mb-8">
        <h2 className="text-section-title mb-1">Who has finished this course</h2>
        {rosterError ? (
          /* A failed query has to say so. An empty table here reads as "nobody
             is signed up", which is how a real fault goes unnoticed. */
          <p className="text-body text-destructive">
            Couldn&apos;t load who is signed up: {rosterError}
          </p>
        ) : roster.length === 0 ? (
          <p className="text-body text-muted-foreground">
            Nobody is signed up to this course.
          </p>
        ) : (
          <>
            <p className="text-meta text-muted-foreground mb-3">
              {finishedAll} of {roster.length} finished all {totalLessons} lesson
              {totalLessons !== 1 ? "s" : ""} · {notStarted} not started
            </p>
            <Surface pad="none">
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Person</TH>
                      <TH numeric>Lessons</TH>
                      <TH>Status</TH>
                      <TH>Last activity</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {roster.map((r) => (
                      <TR key={r.id}>
                        <TD>{r.name}</TD>
                        <TD numeric>
                          {r.done} / {totalLessons}
                        </TD>
                        <TD>
                          {/* Complete is the enrollment's own flag, not the
                              lesson count -- the two can disagree. */}
                          {r.completedAt ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              Complete
                            </Badge>
                          ) : r.done === 0 ? (
                            <Badge variant="outline">Not started</Badge>
                          ) : (
                            <Badge variant="secondary">In progress</Badge>
                          )}
                        </TD>
                        <TD>
                          {r.last ? new Date(r.last).toLocaleDateString() : "—"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            </Surface>
          </>
        )}
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
