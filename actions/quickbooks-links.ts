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
 * The clients still available to link a QuickBooks customer to.
 *
 * Two rules, and they pull in opposite directions.
 *
 * Former clients are in. Matching exists to attach an open balance to whoever
 * ran up the debt, and most unattached balances belong to somebody who has
 * since left -- a list of current clients only is a list that cannot answer the
 * question it is being asked. They are marked, so nobody links to one by
 * accident.
 *
 * Anyone already tied to a customer is out. A client has one set of books
 * behind them, so offering a name that is spoken for is offering a mistake, and
 * on a list of nine hundred the free ones are what somebody is hunting for.
 */
export type LinkableClient = { id: string; name: string; active: boolean };

export async function listClientsForLinking(): Promise<LinkableClient[]> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return [];

  const db = createServiceClient();
  const [{ data: clients }, { data: taken }] = await Promise.all([
    db.from("org_clients").select("id,name,active,status").order("name"),
    db.rpc("get_client_quickbooks", { p_include_inactive: true }),
  ]);

  const spoken_for = new Set(
    ((taken ?? []) as { client_id: string }[]).map((t) => t.client_id)
  );

  type Row = { id: string; name: string; active: boolean; status: string | null };
  return ((clients ?? []) as Row[])
    .filter((c) => !spoken_for.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      active: c.active && (c.status ?? "") !== "Inactive",
    }))
    // Current clients first: the common case should not be scrolled past.
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
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
