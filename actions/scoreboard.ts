"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Correct one activity's type, optionally as a standing rule for every activity
 * of yours with that subject.
 *
 * Deliberately the user's own client, not the service one: set_activity_type
 * enforces "your own activities only" from the signed-in identity, and routing
 * around that here would quietly remove the only check there is.
 *
 * effortSource null clears the correction and restores the classifier's answer.
 */
export async function setActivityType(
  activityId: string,
  effortSource: string | null,
  applyToSubject: boolean
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_activity_type", {
    p_activity_id: activityId,
    p_effort_source: effortSource,
    p_apply_to_subject: applyToSubject,
  });

  if (error) return { success: false, error: error.message };

  // Points move with the correction, so the board is stale too, not just the
  // screen the change was made on.
  revalidatePath("/scoreboard/hustle-points", "layout");
  return { success: true };
}
