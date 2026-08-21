import { cache } from "react";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const getAuthedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async (userId: string) => {
  const serviceClient = createServiceClient();
  const { data } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
});
