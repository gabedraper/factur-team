import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

/**
 * Training administration is now granted through the roles defined in Settings
 * rather than profiles.role, so there is one answer to "what may this person
 * do" instead of two.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const perms = await myPermissions();
  if (!perms.has("lms.admin") && !perms.has("org.manage")) {
    throw new Error("Forbidden: admin access required");
  }
  return user;
}
