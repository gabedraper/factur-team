import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getCourseProgress } from "@/lib/progress";
import { corsJson, corsPreflight } from "@/app/api/extension/_cors";
import { getUserFromBearer } from "@/app/api/extension/_auth";

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const user = await getUserFromBearer(request);

  if (!user) {
    return corsJson(origin, { error: "Not authenticated" }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const { data: enrollments } = await serviceClient
    .from("enrollments")
    .select("course_id, completed_at, courses(id, title)")
    .eq("user_id", user.id);

  const courses = await Promise.all(
    (enrollments ?? []).map(async (enrollment) => {
      const courseRow = enrollment.courses as unknown;
      const course = (Array.isArray(courseRow) ? courseRow[0] : courseRow) as
        | { id: string; title: string }
        | null;
      const progress = enrollment.completed_at
        ? 100
        : await getCourseProgress(serviceClient, user.id, enrollment.course_id);
      return {
        id: course?.id ?? enrollment.course_id,
        title: course?.title ?? "Untitled course",
        progress,
        completed: !!enrollment.completed_at,
      };
    })
  );

  return corsJson(origin, {
    user: {
      id: user.id,
      email: user.email,
      full_name: profile?.full_name ?? null,
      role: profile?.role ?? null,
    },
    courses,
  });
}
