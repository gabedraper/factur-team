"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

export type CollectMethod = "auto" | "we_charge" | "they_pay" | null;

export type InvoiceRow = {
  qb_invoice_id: number;
  invoice_no: string;
  client_id: string;
  client_name: string;
  created_at: string | null;
  sent_at: string | null;
  email_status: string | null;
  due_date: string;
  age_days: number;
  amount: number;
  balance: number;
  paid_on: string | null;
  collect_method: CollectMethod;
  ach_marked_at: string | null;
  ach_marked_by: string | null;
  to_email: string | null;
  pay_link: string | null;
  state: "paid" | "scheduled" | "overdue" | "due today" | "open";
};

async function mayRun() {
  const perms = await myPermissions();
  return perms.has("finance.collections") || perms.has("org.manage");
}

async function whoAmI(): Promise<string | null> {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return user?.email ?? null;
}

export async function getInvoiceRegister(days = 120): Promise<InvoiceRow[]> {
  if (!(await mayRun())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invoice_register", { p_days: days });
  if (error) throw new Error(`invoice register failed: ${error.message}`);
  return (data ?? []) as InvoiceRow[];
}

/**
 * Say that the ACH for this invoice has been taken.
 *
 * The mark is not the truth -- the payment landing in QuickBooks is -- but the
 * truth is minutes or hours behind, and an invoice that still reads unpaid is
 * exactly what makes somebody charge a customer a second time. So the mark
 * covers the gap and then gets out of the way: once the balance clears, the row
 * leaves the worklist whether it was marked or not.
 */
export async function markAchRun(
  invoiceId: number,
  amount: number,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };

  const { error } = await createServiceClient().from("ar_ach_runs").upsert({
    qb_invoice_id: invoiceId,
    amount,
    marked_by: await whoAmI(),
    marked_at: new Date().toISOString(),
    note: note?.trim() || null,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/collections/invoices");
  return { success: true };
}

/** Undo a mark -- the charge failed, or was recorded against the wrong invoice. */
export async function unmarkAchRun(
  invoiceId: number
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };

  const { error } = await createServiceClient()
    .from("ar_ach_runs").delete().eq("qb_invoice_id", invoiceId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/collections/invoices");
  return { success: true };
}

/**
 * Who collects this client's money.
 *
 * Guessed from payment history where the history says so plainly, and null
 * where it does not. A client nobody has classified shows as unknown rather
 * than being quietly filed under "they pay" -- the cost of the wrong guess is
 * an invoice nobody ever collects.
 */
export async function setCollectMethod(
  clientId: string,
  method: CollectMethod
): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRun())) return { success: false, error: "Not permitted." };

  const { error } = await createServiceClient().from("ar_client_settings").upsert({
    client_id: clientId,
    collect_method: method,
    updated_at: new Date().toISOString(),
    updated_by: await whoAmI(),
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/collections/invoices");
  return { success: true };
}
