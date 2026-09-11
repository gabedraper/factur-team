"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

export type Terms = {
  service: string | null;
  total_project_fee: number | null;
  billing_amount: number | null;
  billing_frequency: string | null;
  setup_fee: number | null;
  payment_terms: string | null;
  term_months: number | null;
  term_start: string | null;
  term_end: string | null;
  auto_renew: boolean | null;
  notice_days: number | null;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  billing_contact_phone: string | null;
  opt_outs: string | null;
  other_terms: string | null;
  /** As the contract states it: 1.5 with "month" is 1.5% a month. Zero means it says none. */
  past_due_interest_pct: number | null;
  past_due_interest_period: "month" | "year" | null;
  past_due_interest_after_days: number | null;
  /** The sentence it came from, verbatim. Cleared when someone changes the rate by hand. */
  past_due_interest_clause: string | null;
  past_due_interest_agreement_id: string | null;
  source: "manual" | "contract";
  extracted_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type Kpi = {
  metric: string;
  label: string;
  /** What the contract promised, per month. Null until somebody sets it. */
  target: number | null;
  /** Averaged over the months this client has actually run. */
  actual: number | null;
  source?: string | null;
};

export type Agreement = {
  agreement_id: string | null;
  agreement_name: string | null;
  agreement_signed_on: string | null;
  agreement_source: string | null;
  agreement_file_path: string | null;
  agreement_file_url: string | null;
  terms: Terms | null;
  kpis: Kpi[] | null;
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

export async function getClientAgreement(clientId: string): Promise<Agreement | null> {
  if (!(await mayRead())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_client_agreement", {
    p_client_id: clientId,
  });
  if (error) throw new Error(`client agreement failed: ${error.message}`);
  return ((data ?? []) as Agreement[])[0] ?? null;
}

/**
 * Save the terms.
 *
 * Everything is optional and an empty box means "not stated", not nought. A
 * contract silent on a setup fee should leave the field empty rather than claim
 * it is free -- somebody decides what to invoice off this.
 *
 * Saving marks the row manual. From then on a reading of an agreement may only
 * fill the fields left empty here; it never replaces what a person typed.
 */
export async function saveClientTerms(clientId: string, terms: Partial<Terms>) {
  if (!(await mayRead())) return { success: false, error: "Not permitted." };

  const { error } = await createServiceClient()
    .from("client_terms")
    .upsert(
      {
        client_id: clientId,
        ...terms,
        source: "manual",
        updated_at: new Date().toISOString(),
        updated_by: await whoAmI(),
      },
      { onConflict: "client_id" }
    );
  if (error) return { success: false, error: error.message };

  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}

/**
 * A target of null clears it, which is different from a target of nought.
 * Either way it is now a person's, and a reading of an agreement will leave it.
 */
export async function saveKpiTarget(
  clientId: string,
  metric: string,
  target: number | null
) {
  if (!(await mayRead())) return { success: false, error: "Not permitted." };

  const db = createServiceClient();
  const { error } = await db.from("client_kpi_targets").upsert(
    {
      client_id: clientId,
      metric,
      target_per_month: target,
      source: "manual",
      updated_at: new Date().toISOString(),
      updated_by: await whoAmI(),
    },
    { onConflict: "client_id,metric" }
  );
  if (error) return { success: false, error: error.message };

  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}
