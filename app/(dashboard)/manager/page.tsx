import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
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
import { Users } from "lucide-react";

export default async function ManagerDashboard() {
  const supabase = await createClient();

  const user = await getAuthedUser();

  if (!user) return null;

  // Get team members (users managed by this manager)
  const { data: teamMembers } = await supabase
    .from("profiles")
    .select("*")
    .eq("manager_id", user.id)
    .order("full_name");

  // For each team member, get their enrollments + progress
  const teamData = await Promise.all(
    (teamMembers || []).map(async (member) => {
      const { data: enrollments } = await supabase
        .from("enrollments")
        .select("*, courses(title)")
        .eq("user_id", member.id);

      const enrollmentProgress = await Promise.all(
        (enrollments || []).map(async (e) => {
          const progress = await getCourseProgress(
            supabase,
            member.id,
            e.course_id
          );
          return { ...e, progress };
        })
      );

      const avgProgress =
        enrollmentProgress.length > 0
          ? Math.round(
              enrollmentProgress.reduce((s, e) => s + e.progress, 0) /
                enrollmentProgress.length
            )
          : 0;

      const completedCount = enrollmentProgress.filter(
        (e) => e.progress === 100
      ).length;

      return { ...member, enrollments: enrollmentProgress, avgProgress, completedCount };
    })
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Team</h1>
        <p className="text-muted-foreground mt-1">
          {teamMembers?.length ?? 0} team member
          {(teamMembers?.length ?? 0) !== 1 ? "s" : ""}
        </p>
      </div>

      {teamData.length > 0 ? (
        <div className="space-y-4">
          {teamData.map((member) => (
            <Card key={member.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-medium">
                      {member.full_name?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div>
                      <CardTitle className="text-base">
                        {member.full_name}
                      </CardTitle>
                      <CardDescription className="capitalize">
                        {member.role}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-sm">
                      <div className="font-medium">
                        {member.completedCount}/{member.enrollments.length} courses
                      </div>
                      <div className="text-muted-foreground">completed</div>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/manager/team/${member.id}`}>
                        View Details
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Overall Progress</span>
                    <span>{member.avgProgress}%</span>
                  </div>
                  <Progress value={member.avgProgress} className="h-2" />
                </div>
                {member.enrollments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {member.enrollments.slice(0, 3).map((e: any) => (
                      <div
                        key={e.id}
                        className="text-xs px-2 py-1 bg-muted rounded-md flex items-center gap-1"
                      >
                        <span className="truncate max-w-28">
                          {(e.courses as { title: string } | null)?.title || "Course"}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-xs h-4 px-1"
                        >
                          {e.progress}%
                        </Badge>
                      </div>
                    ))}
                    {member.enrollments.length > 3 && (
                      <span className="text-xs text-muted-foreground px-2 py-1">
                        +{member.enrollments.length - 3} more
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No team members yet</p>
          <p className="text-sm">
            Team members with you set as their manager will appear here
          </p>
        </div>
      )}
    </div>
  );
}
