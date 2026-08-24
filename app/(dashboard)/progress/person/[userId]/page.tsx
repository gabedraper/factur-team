import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { ArrowLeft, Award, CheckCircle } from "lucide-react";

export default async function TeamMemberDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const supabase = await createClient();

  const { data: member } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", (await params).userId)
    .single();

  if (!member) notFound();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*, courses(*)")
    .eq("user_id", (await params).userId)
    .order("enrolled_at", { ascending: false });

  const enrollmentProgress = await Promise.all(
    (enrollments || []).map(async (e) => {
      const progress = await getCourseProgress(supabase, (await params).userId, e.course_id);
      return { ...e, progress };
    })
  );

  const { data: certificates } = await supabase
    .from("certificates")
    .select("*, courses(title)")
    .eq("user_id", (await params).userId);

  const avgProgress =
    enrollmentProgress.length > 0
      ? Math.round(
          enrollmentProgress.reduce((s, e) => s + e.progress, 0) /
            enrollmentProgress.length
        )
      : 0;

  return (
    <div className="p-8 max-w-4xl">
      <Button variant="ghost" asChild className="mb-6 -ml-2">
        <Link href="/progress">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Team
        </Link>
      </Button>

      {/* Member header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-white text-2xl font-bold">
          {member.full_name?.[0]?.toUpperCase() || "U"}
        </div>
        <div>
          <h1 className="text-3xl font-bold">{member.full_name}</h1>
          <p className="text-muted-foreground capitalize">{member.role}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Courses Enrolled
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {enrollmentProgress.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg. Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{avgProgress}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Certificates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">
              {certificates?.length ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Courses */}
      <h2 className="text-xl font-semibold mb-4">Course Progress</h2>
      <div className="space-y-3 mb-8">
        {enrollmentProgress.map((enrollment) => {
          const course = enrollment.courses as {
            id: string;
            title: string;
            description: string | null;
          } | null;
          return (
            <Card key={enrollment.id}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium">{course?.title || "Course"}</p>
                    <p className="text-xs text-muted-foreground">
                      Enrolled{" "}
                      {new Date(enrollment.enrolled_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {enrollment.progress === 100 && (
                      <Badge className="bg-green-100 text-green-700 border-green-200">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Completed
                      </Badge>
                    )}
                    <span className="font-medium text-sm">
                      {enrollment.progress}%
                    </span>
                  </div>
                </div>
                <Progress value={enrollment.progress} className="h-2" />
              </CardContent>
            </Card>
          );
        })}
        {enrollmentProgress.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Not enrolled in any courses yet.
          </p>
        )}
      </div>

      {/* Certificates */}
      {certificates && certificates.length > 0 && (
        <>
          <h2 className="text-xl font-semibold mb-4">Certificates Earned</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {certificates.map((cert) => (
              <Card
                key={cert.id}
                className="border-yellow-200 bg-yellow-50/50"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Award className="h-5 w-5 text-yellow-500" />
                    <CardTitle className="text-base">
                      {(cert.courses as { title: string } | null)?.title || "Course"}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground font-mono">
                    {cert.cert_number}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(cert.issued_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
