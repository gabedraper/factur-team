"use server";

import { createClient } from "@/lib/supabase/server";

/*
 * The one thing on this site a stranger may do.
 *
 * Kept out of actions/nps.ts on purpose. Everything in that file checks
 * `org.manage` first; nothing here can, because the person calling it is a
 * client with no account. Putting the two in one file would invite the next
 * reader to assume a permission check that isn't there.
 *
 * The token is the entire credential, so these go through the anon client
 * rather than the service client -- `record_nps_response` is SECURITY DEFINER
 * and does its own lookup, which means a bad token gets nothing regardless of
 * what is passed in.
 */

export async function submitNpsResponse(
  token: string,
  score: number,
  comment: string | null,
  followUp: boolean | null
): Promise<{ success: boolean; error?: string }> {
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return { success: false, error: "Please choose a number from 0 to 10." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_nps_response", {
    p_token: token,
    p_score: score,
    // For both of these, null means "leave it alone" -- the score is saved on
    // click, so most calls here are touching one field and not the other.
    // An empty comment means the client cleared the box.
    p_comment: comment,
    p_follow_up: followUp,
  });

  if (error) {
    return { success: false, error: "That didn't save. Please try again." };
  }
  return { success: true };
}
