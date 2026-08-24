"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getRoleLabel } from "@/lib/roles";

export async function getProgressReport() {
  // A server action is reachable over HTTP by anyone who can reach the app, and
  // this one reads with the service key -- which ignores row security. The page
  // above it is inside the signed-in area; this makes the action itself say so.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Not signed in");

  const supabase = createServiceClient();

  // All non-admin profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .neq("role", "admin")
    .order("full_name");

  // Auth emails
  const { data: authData } = await supabase.auth.admin.listUsers();
  const emailMap: Record<string, string> = {};
  authData?.users?.forEach((u) => { emailMap[u.id] = u.email || ""; });

  // All role-course assignments
  const { data: roleCourses } = await supabase
    .from("role_courses")
    .select("role, course_id, courses(id, title)");

  // All lesson_progress rows (bulk fetch — cheaper than per-user queries)
  const { data: allProgress } = await supabase
    .from("lesson_progress")
    .select("user_id, lesson_id");

  // All lessons grouped by course
  const { data: allModules } = await supabase
    .from("modules")
    .select("id, course_id");

  const { data: allLessons } = await supabase
    .from("lessons")
    .select("id, module_id");

  // Build lookup: courseId → lessonIds
  const modulesByCourse: Record<string, string[]> = {};
  (allModules || []).forEach((m) => {
    if (!modulesByCourse[m.course_id]) modulesByCourse[m.course_id] = [];
    modulesByCourse[m.course_id].push(m.id);
  });

  const lessonsByModule: Record<string, string[]> = {};
  (allLessons || []).forEach((l) => {
    if (!lessonsByModule[l.module_id]) lessonsByModule[l.module_id] = [];
    lessonsByModule[l.module_id].push(l.id);
  });

  function getLessonsForCourse(courseId: string): string[] {
    const moduleIds = modulesByCourse[courseId] || [];
    return moduleIds.flatMap((mid) => lessonsByModule[mid] || []);
  }

  // Build lookup: userId → Set of completed lessonIds
  const completedByUser: Record<string, Set<string>> = {};
  (allProgress || []).forEach((p) => {
    if (!completedByUser[p.user_id]) completedByUser[p.user_id] = new Set();
    completedByUser[p.user_id].add(p.lesson_id);
  });

  // Build role → courses map
  const coursesByRole: Record<string, { id: string; title: string }[]> = {};
  (roleCourses || []).forEach((rc: any) => {
    if (!coursesByRole[rc.role]) coursesByRole[rc.role] = [];
    if (rc.courses) coursesByRole[rc.role].push(rc.courses);
  });

  // Build per-user report
  const users = (profiles || []).map((profile) => {
    const assignedCourses = coursesByRole[profile.role] || [];
    const completedSet = completedByUser[profile.id] || new Set();

    const courses = assignedCourses.map((course) => {
      const lessonIds = getLessonsForCourse(course.id);
      const total = lessonIds.length;
      const done = lessonIds.filter((lid) => completedSet.has(lid)).length;
      const progress = total > 0 ? Math.round((done / total) * 100) : 0;
      return { id: course.id, title: course.title, progress, total, done };
    });

    const overallProgress = courses.length > 0
      ? Math.round(courses.reduce((sum, c) => sum + c.progress, 0) / courses.length)
      : 0;

    const completedCourses = courses.filter((c) => c.progress === 100).length;

    return {
      id: profile.id,
      name: profile.full_name || "Unknown",
      email: emailMap[profile.id] || "",
      role: profile.role,
      roleLabel: getRoleLabel(profile.role),
      courses,
      overallProgress,
      completedCourses,
      totalCourses: courses.length,
    };
  });

  // Summary stats
  const totalUsers = users.length;
  const usersWithCourses = users.filter((u) => u.totalCourses > 0);
  const avgProgress = usersWithCourses.length > 0
    ? Math.round(usersWithCourses.reduce((s, u) => s + u.overallProgress, 0) / usersWithCourses.length)
    : 0;
  const fullyComplete = users.filter((u) => u.totalCourses > 0 && u.completedCourses === u.totalCourses).length;
  const notStarted = users.filter((u) => u.totalCourses > 0 && u.overallProgress === 0).length;

  return { users, totalUsers, avgProgress, fullyComplete, notStarted };
}
