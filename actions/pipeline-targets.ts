"use server";

import { createClient } from "@/lib/supabase/server";
import { assertPipeline } from "@/lib/pipeline/access";

/*
 * Reads behind the target account screens.
 *
 * The pipeline is stored one pursuit per (client, contact) -- the right grain
 * for the work, the wrong one for the screen. Nobody works a contact in
 * isolation; they work a company, and the people they know there are how they
 * get in. These roll that up.
 *
 * Every one of them goes through the user-scoped client, never the service
 * client: RLS on opportunities already limits a viewer to clients they hold a
 * role on, and that is the real guard. Asking for a client you cannot see
 * returns nothing, which is the same answer the policy gives.
 */

import type {
  TargetAccount, AccountContact, UnworkedContact, CampaignMembership,
  TargetContact,
} from "@/lib/pipeline/targets";

export async function listTargetAccounts(input: {
  clientId: string;
  stages?: string[];
  search?: string;
  openOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rows: TargetAccount[]; total: number }> {
  await assertPipeline();
  const db = await createClient();
  const { data, error } = await db.rpc("pipeline_target_accounts", {
    p_client_id: input.clientId,
    p_stages: input.stages?.length ? input.stages : null,
    p_search: input.search || null,
    p_open_only: input.openOnly ?? false,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as TargetAccount[];
  /* total_count rides on every row; with no rows there is nothing to total. */
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

/*
 * Both halves of an account in one call. The panel always shows the two
 * together -- who we are talking to, and who else is there -- so fetching them
 * separately would only mean two spinners instead of one.
 */
export async function getAccountDetail(input: { clientId: string; accountId: string }): Promise<{
  contacts: AccountContact[];
  unworked: UnworkedContact[];
  campaigns: CampaignMembership[];
}> {
  await assertPipeline();
  const db = await createClient();

  const [worked, rest, campaigns] = await Promise.all([
    db.rpc("pipeline_account_contacts", {
      p_client_id: input.clientId, p_account_id: input.accountId,
    }),
    db.rpc("pipeline_account_unworked_contacts", {
      p_client_id: input.clientId, p_account_id: input.accountId, p_limit: 50,
    }),
    /* Campaign membership is a property of the company and its people, not of
       this client's pursuit of them, so it is not scoped by client. */
    db.rpc("account_campaign_memberships", { p_account_id: input.accountId }),
  ]);
  if (worked.error) throw new Error(worked.error.message);
  if (rest.error) throw new Error(rest.error.message);
  if (campaigns.error) throw new Error(campaigns.error.message);

  return {
    contacts: (worked.data ?? []) as AccountContact[],
    unworked: (rest.data ?? []) as UnworkedContact[],
    campaigns: (campaigns.data ?? []) as CampaignMembership[],
  };
}

/*
 * The same pipeline as listTargetAccounts, one row per person instead of one
 * per company. Server-paged for the same reason: the largest client is pursuing
 * 41,260 companies, and rather more people than that.
 */
export async function listTargetContacts(input: {
  clientId: string;
  stages?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: TargetContact[]; total: number }> {
  await assertPipeline();
  const db = await createClient();
  const { data, error } = await db.rpc("pipeline_target_contacts", {
    p_client_id: input.clientId,
    p_stages: input.stages?.length ? input.stages : null,
    p_search: input.search || null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as TargetContact[];
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}
