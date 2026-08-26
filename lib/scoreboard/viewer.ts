import type { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { previewedMemberId } from "@/lib/org";

/**
 * Which rep the scoreboard should behave as.
 *
 * Preview-aware on purpose: "view as John Boss" is meant to show John's screen,
 * and a viewer id that stayed the admin's own would leave the board masking and
 * the edit controls answering for the wrong person -- which looks like a bug in
 * the feature rather than the preview.
 */
export async function getViewerRepId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const previewing = await previewedMemberId();
  if (previewing) {
    const db = createServiceClient();
    const { data: member } = await db
      .from("org_members")
      .select("rep_id, salesforce_user_id")
      .eq("id", previewing)
      .maybeSingle();

    if (member?.rep_id) return member.rep_id as string;
    if (member?.salesforce_user_id) {
      const { data: rep } = await db
        .from("reps")
        .select("id")
        .eq("salesforce_owner_id", member.salesforce_user_id)
        .maybeSingle();
      if (rep) return rep.id as string;
    }
    // A previewed person with no rep row has no scoreboard identity; falling
    // back to the admin's own would silently show the wrong screen.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: byAuthId } = await supabase
    .from("reps")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (byAuthId) return byAuthId.id;

  // Fallback for a first login before the signup-linking trigger has run, or if
  // it ever mismatches -- without this, someone would see their own row masked.
  if (!user.email) return null;
  const { data: byEmail } = await supabase
    .from("reps")
    .select("id")
    .ilike("email", user.email)
    .maybeSingle();

  return byEmail?.id ?? null;
}
