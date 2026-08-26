"use server";

import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

/**
 * The five ageing buckets are the ones the A/R Ageing Summary uses, each
 * holding only its own slice, so they add up to the open balance.
 */
export type BillingSummary = {
  qb_customer: string;
  payment_terms: string | null;
  open_balance: number;
  bucket_current: number;
  bucket_1_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_91_plus: number;
  /** Null where nothing they have been invoiced is settled yet. */
  avg_days_to_pay: number | null;
  invoices_paid: number;
};

/**
 * A client's standing balance, or null where QuickBooks has nothing to say.
 *
 * Null covers two different situations -- no customer matched to this client,
 * and a customer who owes nothing -- and the screen treats them the same,
 * because a row of zeroes is not worth the space either way.
 */
export async function getBillingSummary(
  clientId: string
): Promise<BillingSummary | null> {
  const perms = await myPermissions();
  if (!perms.has("clients.health") && !perms.has("org.manage")) return null;

  // The user's own connection: the function checks is_factur_user(), which
  // reads their token.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_client_billing_summary", {
    p_client_id: clientId,
  });
  if (error) throw new Error(`billing summary failed: ${error.message}`);

  const row = ((data ?? []) as BillingSummary[])[0];
  return row ?? null;
}
