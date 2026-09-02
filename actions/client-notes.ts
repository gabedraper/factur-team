"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

export type ClientNote = {
  /** Null for the QuickBooks note, which is why it cannot be edited here. */
  id: string | null;
  source: "app" | "quickbooks";
  body: string;
  pinned: boolean;
  author_email: string | null;
  created_at: string | null;
};

async function mayRead() {
  const perms = await myPermissions();
  return (
    perms.has("clients.health") ||
    perms.has("finance.collections") ||
    perms.has("org.manage")
  );
}

async function whoAmI(): Promise<string | null> {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return user?.email ?? null;
}

export async function getClientNotes(clientId: string): Promise<ClientNote[]> {
  if (!(await mayRead())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_client_notes", {
    p_client_id: clientId,
  });
  if (error) throw new Error(`client notes failed: ${error.message}`);
  return (data ?? []) as ClientNote[];
}

export async function addClientNote(clientId: string, body: string, pinned: boolean) {
  if (!(await mayRead())) return { success: false, error: "Not permitted." };
  if (!body.trim()) return { success: false, error: "Nothing to save." };

  const { error } = await createServiceClient().from("client_notes").insert({
    client_id: clientId,
    body: body.trim(),
    pinned,
    author_email: await whoAmI(),
  });
  if (error) return { success: false, error: error.message };

  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}

/** Pinning is the whole point of the feature, so it is one click and no dialog. */
export async function setNotePinned(clientId: string, noteId: string, pinned: boolean) {
  if (!(await mayRead())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("client_notes")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", noteId);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}

/**
 * Deleting is offered because a note written on the wrong client is worse than
 * no note. Only ours -- the QuickBooks one has a null id and never reaches here.
 */
export async function deleteClientNote(clientId: string, noteId: string) {
  if (!(await mayRead())) return { success: false, error: "Not permitted." };
  const { error } = await createServiceClient()
    .from("client_notes")
    .delete()
    .eq("id", noteId);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}
