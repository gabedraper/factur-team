"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

export type NpsEntry = {
  id: string;
  score: number;
  collected_on: string;
  respondent: string | null;
  comment: string | null;
};

export async function listNps(clientId: string): Promise<NpsEntry[]> {
  const { data } = await createServiceClient()
    .from("client_nps")
    .select("id,score,collected_on,respondent,comment")
    .eq("client_id", clientId)
    .order("collected_on", { ascending: false });
  return (data ?? []) as NpsEntry[];
}

export async function recordNps(
  clientId: string,
  score: number,
  collectedOn: string,
  respondent: string,
  comment: string
) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return { success: false, error: "Not permitted." };

  // The survey's own scale. A score outside it is a typo, and a typo nobody can
  // trace back is worse than a refused form.
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return { success: false, error: "Score must be a whole number from 0 to 10." };
  }
  if (!collectedOn) return { success: false, error: "Pick the date it was collected." };

  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  const { error } = await createServiceClient().from("client_nps").insert({
    client_id: clientId,
    score,
    collected_on: collectedOn,
    respondent: respondent.trim() || null,
    comment: comment.trim() || null,
    recorded_by: user?.id ?? null,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath(`/settings/clients/${clientId}`);
  revalidatePath("/clients/health");
  return { success: true };
}

/** For a mistyped entry. History is only worth keeping if it is correctable. */
export async function deleteNps(id: string, clientId: string) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return { success: false, error: "Not permitted." };

  const { error } = await createServiceClient().from("client_nps").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/settings/clients/${clientId}`);
  revalidatePath("/clients/health");
  return { success: true };
}
