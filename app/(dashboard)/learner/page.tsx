import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/session";
import { myRoleIds } from "@/lib/org";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { getCourseProgress } from "@/lib/progress";
import { GraduationCap } from "lucide-react";
import { getRoleLabel } from "@/lib/roles";
import { getCourseGradientStyle } from "@/lib/course-colors";

export default async function LearnerDashboard() {
  const supabase = await createClient();
  const serviceClient = createServiceClient();

  const user = await getAuthedUser();

  if (!user) return null;

  // Get user's role
  const profile = await getProfile(user.id);

  // Assigned training follows the roles held in Settings, so someone in two
  // roles sees both sets rather than whichever single role happened to be on
  // their profile.
  const roleIds = await myRoleIds();

  // Get courses assigned to this role, and this user's enrollments, in parallel
  const [{ data: roleCourses }, { data: enrollments }] = await Promise.all([
    serviceClient
      .from("role_courses")
      .select("course_id, courses(id, title, description, thumbnail_url, is_published)")
      .in("role_id", roleIds.length ? roleIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase
      .from("enrollments")
      .select("course_id, completed_at, enrolled_at")
      .eq("user_id", user.id),
  ]);

  const assignedCourses = (roleCourses || [])
    .map((rc: any) => rc.courses)
    .filter(Boolean)
    .filter((c: any) => c.is_published);

  const enrollmentMap: Record<string, { completed_at: string | null }> = {};
  (enrollments || []).forEach((e: any) => {
    enrollmentMap[e.course_id] = e;
  });

  // Calculate progress for each assigned course
  const coursesWithProgress = await Promise.all(
    assignedCourses.map(async (course: any) => {
      const progress = await getCourseProgress(supabase, user.id, course.id);
      return { ...course, progress, enrollment: enrollmentMap[course.id] || null };
    })
  );

  const inProgress = coursesWithProgress.filter((c) => c.progress > 0 && !c.enrollment?.completed_at);
  const notStarted = coursesWithProgress.filter((c) => c.progress === 0 && !c.enrollment?.completed_at);
  const completed = coursesWithProgress.filter((c) => c.enrollment?.completed_at);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Training</h1>
        <p className="text-muted-foreground mt-1">
          {coursesWithProgress.length} course{coursesWithProgress.length !== 1 ? "s" : ""} assigned
        </p>
      </div>

      {coursesWithProgress.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border-2 border-dashed rounded-lg">
          <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No training assigned yet.</p>
          <p className="text-sm mt-1">Your administrator will assign courses to your role.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {inProgress.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-4">In Progress</h2>
              <CourseGrid courses={inProgress} />
            </section>
          )}
          {notStarted.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Not Started</h2>
              <CourseGrid courses={notStarted} />
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Completed</h2>
              <CourseGrid courses={completed} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function CourseGrid({ courses }: { courses: any[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {courses.map((course) => (
        <Card key={course.id} className="overflow-hidden">
          <div
            className="h-32"
            style={
              course.thumbnail_url
                ? { backgroundImage: `url(${course.thumbnail_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                : getCourseGradientStyle(course.id)
            }
          />
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base line-clamp-1">{course.title}</CardTitle>
              {course.enrollment?.completed_at && (
                <Badge variant="default" className="text-xs shrink-0">Completed</Badge>
              )}
            </div>
            {course.description && (
              <CardDescription className="line-clamp-2">{course.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {!course.enrollment?.completed_at && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Progress</span>
                  <span>{course.progress}%</span>
                </div>
                <Progress value={course.progress} className="h-2" />
              </div>
            )}
            <Button asChild size="sm" className="w-full" variant={course.enrollment?.completed_at ? "outline" : "default"}>
              <Link href={`/learner/courses/${course.id}`}>
                {course.enrollment?.completed_at ? "Review" : course.progress > 0 ? "Continue" : "Start"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
