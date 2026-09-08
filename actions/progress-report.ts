"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { roleLabelsForUsers } from "@/lib/org";

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
    .select("id, full_name, role, avatar_url")
    .neq("role", "admin")
    .order("full_name");

  // Auth emails
  const { data: authData } = await supabase.auth.admin.listUsers();
  const emailMap: Record<string, string> = {};
  authData?.users?.forEach((u) => { emailMap[u.id] = u.email || ""; });

  // All role-course assignments
  const { data: roleCourses } = await supabase
    .from("role_courses")
    // role_id, not role. The column was renamed when roles moved to Settings
    // and this query was not, so it asked for a column that no longer exists,
    // failed, and every person in the report showed nought courses and nought
    // per cent -- which reads as nobody having done any training rather than as
    // a broken query.
    .select("role_id, course_id, courses(id, title)");

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

  // Which courses each role is assigned, keyed on the role id from Settings.
  const coursesByRole: Record<string, { id: string; title: string }[]> = {};
  (roleCourses || []).forEach((rc: any) => {
    if (!rc.role_id) return;
    if (!coursesByRole[rc.role_id]) coursesByRole[rc.role_id] = [];
    if (rc.courses) coursesByRole[rc.role_id].push(rc.courses);
  });

  /*
   * Which roles each person holds, from Settings rather than profiles.role.
   * Somebody with two roles is assigned the training for both, which is the
   * behaviour anybody would expect and which the old single-value column could
   * not express.
   */
  const { data: assignments } = await supabase
    .from("org_members")
    .select("auth_user_id, org_assignments(role_id)");

  const rolesByUser = new Map<string, string[]>();
  for (const m of (assignments ?? []) as any[]) {
    if (!m.auth_user_id) continue;
    rolesByUser.set(
      m.auth_user_id,
      (m.org_assignments ?? []).map((a: any) => a.role_id).filter(Boolean)
    );
  }

  const roleLabels = await roleLabelsForUsers(
    (profiles || []).map((p: any) => p.id)
  );

  // Build per-user report
  const users = (profiles || []).map((profile) => {
    const assignedCourses = [
      ...new Map(
        (rolesByUser.get(profile.id) ?? [])
          .flatMap((roleId) => coursesByRole[roleId] ?? [])
          // Two roles sharing a course is one course to do, not two.
          .map((c) => [c.id, c] as const)
      ).values(),
    ];
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
      avatarUrl: profile.avatar_url as string | null,
      email: emailMap[profile.id] || "",
      role: profile.role,
      roleLabel: roleLabels.get(profile.id) ?? "No role set",
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
