import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";
import { getRoleLabel } from "@/lib/roles";
import { Trophy, Medal } from "lucide-react";
import { Avatar } from "@/components/ui/thumbnail";

export default async function LeaderboardPage() {
  const supabase = createServiceClient();

  const user = await getAuthedUser();
  if (!user) return null;

  // Get all profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role, avatar_url");

  // Get lesson completion counts per user
  const { data: progress } = await supabase
    .from("lesson_progress")
    .select("user_id");

  // Count completions per user
  const countMap: Record<string, number> = {};
  (progress || []).forEach((p) => {
    countMap[p.user_id] = (countMap[p.user_id] || 0) + 1;
  });

  // Get course completion counts
  const { data: completedCourses } = await supabase
    .from("enrollments")
    .select("user_id, completed_at")
    .not("completed_at", "is", null);

  const courseCountMap: Record<string, number> = {};
  (completedCourses || []).forEach((e) => {
    courseCountMap[e.user_id] = (courseCountMap[e.user_id] || 0) + 1;
  });

  // Build leaderboard rows
  const rows = (profiles || [])
    .map((p) => ({
      ...p,
      lessonsCompleted: countMap[p.id] || 0,
      coursesCompleted: courseCountMap[p.id] || 0,
    }))
    .filter((r) => r.lessonsCompleted > 0 || r.coursesCompleted > 0)
    .sort((a, b) => b.lessonsCompleted - a.lessonsCompleted || b.coursesCompleted - a.coursesCompleted);

  const medalColors = ["text-yellow-500", "text-gray-400", "text-amber-600"];

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8 flex items-center gap-3">
        <Trophy className="h-8 w-8 text-yellow-500" />
        <div>
          <h1 className="text-3xl font-bold">Leaderboard</h1>
          <p className="text-muted-foreground mt-0.5">Ranked by lessons completed</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border-2 border-dashed rounded-lg">
          <Trophy className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>No completions yet. Be the first!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const isCurrentUser = row.id === user.id;
            return (
              <div
                key={row.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                  isCurrentUser ? "bg-primary/5 border-primary/30" : "bg-card"
                }`}
              >
                {/* Rank */}
                <div className="w-8 text-center shrink-0">
                  {idx < 3 ? (
                    <Medal className={`h-5 w-5 mx-auto ${medalColors[idx]}`} />
                  ) : (
                    <span className="text-sm font-semibold text-muted-foreground">#{idx + 1}</span>
                  )}
                </div>

                {/* Avatar */}
                <Avatar
                  name={row.full_name ?? "?"}
                  src={row.avatar_url}
                  size={36}
                />

                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {row.full_name}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-primary font-normal">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{getRoleLabel(row.role)}</p>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-6 text-right shrink-0">
                  <div>
                    <p className="text-lg font-bold">{row.lessonsCompleted}</p>
                    <p className="text-xs text-muted-foreground">lessons</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{row.coursesCompleted}</p>
                    <p className="text-xs text-muted-foreground">courses</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
