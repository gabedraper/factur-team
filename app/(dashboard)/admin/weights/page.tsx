import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";
import { WeightsEditor } from "./WeightsEditor";
import { HIDDEN_EFFORT_SOURCES, sortByEffortCategory } from "@/lib/scoreboard/effort-weights";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function AdminWeightsPage() {
  const supabase = await createClient();
  const perms = await myPermissions();
  if (!perms.has("scoreboard.weights.edit")) {
    return <NoAccess section="Effort Weights" need="Edit scoring weights" />;
  }

  const { data: weightsRaw } = await supabase
    .from("effort_weights")
    .select("effort_source, points, description");
  const weights = sortByEffortCategory(weightsRaw ?? []);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Settings
      </Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Effort Weights</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Points per activity type. Changes apply to the leaderboard on the next
        recompute.
      </p>

      <WeightsEditor
        weights={weights.filter((w) => !HIDDEN_EFFORT_SOURCES.has(w.effort_source))}
      />
    </div>
  );
}
