"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateWeights(
  updates: { effort_source: string; points: number }[]
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: rep } = await supabase
    .from("reps")
    .select("is_admin")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!rep?.is_admin) throw new Error("Forbidden");

  for (const { effort_source, points } of updates) {
    if (!effort_source || Number.isNaN(points)) throw new Error("Invalid input");
    const { error } = await supabase
      .from("effort_weights")
      .update({ points })
      .eq("effort_source", effort_source);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/admin/weights");
}
