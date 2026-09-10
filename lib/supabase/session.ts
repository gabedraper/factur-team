import { cache } from "react";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const getAuthedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * The profile row, or null when there genuinely is none.
 *
 * Those are different answers and they must not collapse into one. "No row"
 * means the sign-in was not a Factur address -- handle_new_user() only creates
 * profiles for the allowed domains -- and the right response is the
 * unauthorised page. "Could not read the row" means the database had a bad
 * moment, and the right response is an error you can retry.
 *
 * This used to discard the error, so a statement timeout on this one query
 * told a real Factur employee they were "not a Factur account" and to sign out
 * of Google -- wrong, and advice that made things worse.
 *
 * maybeSingle(), not single(): single() reports zero rows *as* an error, which
 * is exactly the conflation this function exists to avoid.
 */
export const getProfile = cache(async (userId: string) => {
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read your profile: ${error.message}`);
  return data;
});
