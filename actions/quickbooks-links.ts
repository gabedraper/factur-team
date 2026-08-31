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

/**
 * Every client, in one alphabetical list, with the ones already spoken for
 * marked as such.
 *
 * Inactive clients are in. Matching exists to attach an open balance to whoever
 * ran up the debt, and most unattached balances belong to somebody who has
 * since left -- a list of current clients only cannot answer the question it is
 * being asked.
 *
 * Clients already tied to a customer are in too, pickable, and in the same
 * alphabetical run as everybody else. Leaving them out was a lie by omission;
 * greying them out at the bottom was the same lie said more quietly, and the
 * premise under both -- a client has one set of books -- is not what the books
 * say. QuickBooks writes the same company two or three ways, so a client
 * already holding one of those customers is exactly the answer somebody is
 * hunting for on the next. The name it is matched to is written beside it, and
 * a person decides.
 */
export type LinkableClient = {
  id: string;
  name: string;
  active: boolean;
  /** The QuickBooks customer already on this client, if any. */
  matchedTo: string | null;
};

export async function listClientsForLinking(): Promise<LinkableClient[]> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return [];

  const db = createServiceClient();
  const [{ data: clients }, { data: taken }] = await Promise.all([
    db.from("org_clients").select("id,name,active,status").order("name"),
    db.rpc("get_client_quickbooks", { p_include_inactive: true }),
  ]);

  // A client can hold more than one customer through a hand-made link, so the
  // names are gathered rather than the last one winning.
  const spoken_for = new Map<string, string[]>();
  for (const t of (taken ?? []) as { client_id: string; qb_customer_name: string }[]) {
    spoken_for.set(t.client_id, [...(spoken_for.get(t.client_id) ?? []), t.qb_customer_name]);
  }

  type Row = { id: string; name: string; active: boolean; status: string | null };
  return ((clients ?? []) as Row[])
    .map((c) => ({
      id: c.id,
      name: c.name,
      active: c.active && (c.status ?? "") !== "Inactive",
      matchedTo: spoken_for.get(c.id)?.join(", ") ?? null,
    }))
    // Plain alphabetical, in one run. A list that starts at A again halfway
    // down reads as a list that does not hold the name being looked for.
    .sort((a, b) => a.name.localeCompare(b.name));
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
