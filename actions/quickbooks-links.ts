"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

export type UnmatchedCustomer = {
  qb_customer_name: string;
  owed: number;
  overdue_60_plus: number;
  suggested_client_id: string | null;
  suggested_client_name: string | null;
  score: number | null;
  already_decided: boolean;
};

export async function listUnmatchedQuickbooks(): Promise<UnmatchedCustomer[]> {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_unmatched_quickbooks");
  if (error) throw new Error(`unmatched customers failed: ${error.message}`);
  return (data ?? []) as UnmatchedCustomer[];
}

export async function listClientsForLinking(): Promise<{ id: string; name: string }[]> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return [];

  const { data } = await createServiceClient()
    .from("org_clients")
    .select("id,name")
    .eq("active", true)
    .neq("status", "Inactive")
    .order("name");
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Tie a QuickBooks customer to a client, or record that it belongs to none.
 *
 * A rejection is stored rather than simply skipped, or the same wrong
 * suggestion returns every time somebody opens the list -- and "this is
 * nobody's" is a real answer here, since former clients and one-off customers
 * both sit in the books.
 */
export async function decideQuickbooksLink(
  qbCustomerName: string,
  clientId: string | null
) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return { success: false, error: "Not permitted." };

  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  const { error } = await createServiceClient()
    .from("client_quickbooks_links")
    .upsert(
      {
        qb_customer_name: qbCustomerName,
        client_id: clientId,
        rejected: clientId === null,
        decided_by: user?.id ?? null,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "qb_customer_name" }
    );
  if (error) return { success: false, error: error.message };

  revalidatePath("/clients/health");
  revalidatePath("/settings/quickbooks");
  return { success: true };
}
