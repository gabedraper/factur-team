import type { createClient } from "@/lib/supabase/server";

export async function getViewerRepId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
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
