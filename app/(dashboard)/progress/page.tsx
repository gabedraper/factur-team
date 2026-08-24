import { getProgressReport } from "@/actions/progress-report";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Users, TrendingUp, CheckCircle2, AlertCircle } from "lucide-react";

export default async function ProgressDashboard() {
  const { users, totalUsers, avgProgress, fullyComplete, notStarted } =
    await getProgressReport();

  const stats = [
    {
      label: "Total Members",
      value: totalUsers,
      icon: <Users className="h-5 w-5 text-blue-600" />,
      bg: "bg-blue-50",
    },
    {
      label: "Avg. Completion",
      value: `${avgProgress}%`,
      icon: <TrendingUp className="h-5 w-5 text-indigo-600" />,
      bg: "bg-indigo-50",
    },
    {
      label: "Fully Complete",
      value: fullyComplete,
      icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
      bg: "bg-green-50",
    },
    {
      label: "Not Started",
      value: notStarted,
      icon: <AlertCircle className="h-5 w-5 text-amber-600" />,
      bg: "bg-amber-50",
    },
  ];

  // Group by role for the role breakdown section
  const byRole: Record<string, typeof users> = {};
  users.forEach((u) => {
    if (!byRole[u.roleLabel]) byRole[u.roleLabel] = [];
    byRole[u.roleLabel].push(u);
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Team Progress</h1>
        <p className="text-muted-foreground mt-1">
          Track every team member's training completion
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <div className={`${s.bg} p-2 rounded-md`}>{s.icon}</div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-user table */}
      <Card>
        <CardHeader>
          <CardTitle>Member Progress</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              No team members yet. Invite users from the Users page.
            </div>
          ) : (
            <div className="divide-y">
              {users.map((user) => (
                <div key={user.id} className="px-6 py-4">
                  {/* User header row */}
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-semibold shrink-0">
                        {user.name[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                        {user.roleLabel}
                      </Badge>
                      {user.totalCourses > 0 ? (
                        <div className="text-right">
                          <span className="text-sm font-semibold">{user.overallProgress}%</span>
                          <p className="text-xs text-muted-foreground">
                            {user.completedCourses}/{user.totalCourses} courses
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No courses assigned</span>
                      )}
                    </div>
                  </div>

                  {/* Overall bar */}
                  {user.totalCourses > 0 && (
                    <div className="mb-3">
                      <Progress
                        value={user.overallProgress}
                        className="h-2"
                      />
                    </div>
                  )}

                  {/* Per-course breakdown */}
                  {user.courses.length > 0 && (
                    <div className="space-y-2 pl-12">
                      {user.courses.map((course) => (
                        <div key={course.id} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                            {course.title}
                          </span>
                          <div className="flex items-center gap-2 shrink-0 w-40">
                            <Progress value={course.progress} className="h-1.5 flex-1" />
                            <span className="text-xs text-muted-foreground w-8 text-right">
                              {course.progress}%
                            </span>
                          </div>
                          {course.progress === 100 && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
