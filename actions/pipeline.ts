"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId, myPermissions } from "@/lib/org";
import { assertPipeline } from "@/lib/pipeline/access";

/**
 * Opportunities: one Client's pursuit of one Contact.
 *
 * createOpportunity checks for an existing (client_id, contact_id) row itself,
 * ahead of the insert, so a duplicate pursuit comes back as a plain message
 * instead of a raw Postgres unique-violation. It also checks for a rep
 * collision -- the same Account Manager already representing a different
 * Client against this same Contact -- and returns that as a warning rather
 * than blocking the write; whether it's a problem is a human's call.
 */

async function ctx() {
  await assertPipeline("view");
  return { supabase: await createClient(), me: await currentMemberId() };
}

export type OpportunityInput = {
  client_id: string;
  contact_id: string;
  account_id?: string | null;
  stage?: string;
  lead_status?: string | null;
  notes?: string | null;
};

export type RepCollision = {
  account_manager_id: string;
  other_client_id: string;
  other_opportunity_id: string;
};

/**
 * Mirrors OpportunityHelper.getName() in Apex exactly -- Salesforce requires
 * Name to create an Opportunity, and its own naming trigger never fires for
 * Skyvia's sync-originated writes (triggers are deliberately bypassed for
 * that user), so the app has to produce the same name Salesforce would have.
 */
function computeOpportunityName(accountName: string | null, clientName: string, contactName: string): string {
  const name = accountName
    ? `${accountName} - ${clientName} - ${contactName}`
    : `${clientName} - ${contactName}`;
  return name.length > 119 ? name.slice(0, 119) : name;
}

async function checkRepCollision(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  contactId: string
): Promise<RepCollision | null> {
  const { data: client } = await supabase
    .from("org_clients")
    .select("account_manager_id")
    .eq("id", clientId)
    .maybeSingle();
  const accountManagerId = (client as { account_manager_id: string | null } | null)?.account_manager_id;
  if (!accountManagerId) return null;

  const { data: collision } = await supabase
    .from("opportunities")
    .select("id, client_id, org_clients!inner(account_manager_id)")
    .eq("contact_id", contactId)
    .neq("client_id", clientId)
    .eq("org_clients.account_manager_id", accountManagerId)
    .maybeSingle();

  if (!collision) return null;
  const row = collision as unknown as { id: string; client_id: string };
  return { account_manager_id: accountManagerId, other_client_id: row.client_id, other_opportunity_id: row.id };
}

export async function createOpportunity(input: OpportunityInput) {
  const { supabase, me } = await ctx();

  const { data: existing } = await supabase
    .from("opportunities")
    .select("id")
    .eq("client_id", input.client_id)
    .eq("contact_id", input.contact_id)
    .maybeSingle();
  if (existing) throw new Error("This client already has a pursuit open against that contact.");

  const collision = await checkRepCollision(supabase, input.client_id, input.contact_id);

  const [{ data: client }, { data: contact }, { data: account }] = await Promise.all([
    supabase.from("org_clients").select("name").eq("id", input.client_id).single(),
    supabase.from("crm_contacts").select("first_name, last_name").eq("id", input.contact_id).single(),
    input.account_id
      ? supabase.from("crm_accounts").select("name").eq("id", input.account_id).single()
      : Promise.resolve({ data: null }),
  ]);
  const clientName = (client as { name: string } | null)?.name ?? "";
  const contactRow = contact as { first_name: string | null; last_name: string | null } | null;
  const contactName = [contactRow?.first_name, contactRow?.last_name].filter(Boolean).join(" ");
  const accountName = (account as { name: string } | null)?.name ?? null;

  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      ...input,
      name: computeOpportunityName(accountName, clientName, contactName),
      close_date: new Date().toISOString().slice(0, 10),
      created_by: me,
      updated_by: me,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create that opportunity: ${error.message}`);

  await supabase.rpc("record_opportunity_history", { p_source: "manual" });
  revalidatePath("/opportunities", "layout");

  return { id: (data as { id: string }).id, collision };
}

export type OpportunityUpdate = Partial<
  Pick<
    OpportunityInput,
    "stage" | "lead_status" | "notes" | "account_id"
  > & {
    reached_lead: boolean;
    reached_eval_call_scheduled: boolean;
    reached_selling: boolean;
    reached_discovery: boolean;
    reached_proposal: boolean;
    reached_closing: boolean;
    closed_on: string | null;
    // Columns added by pipeline_next_action_and_updates -- editable from the
    // app by design, just never added to this type until the pipeline UI
    // existed to edit them.
    next_action_date: string | null;
    updates: string | null;
  }
>;

export async function updateOpportunity(id: string, patch: OpportunityUpdate) {
  const { supabase, me } = await ctx();

  const { error } = await supabase
    .from("opportunities")
    .update({ ...patch, updated_by: me })
    .eq("id", id);
  if (error) throw new Error(`Could not update that opportunity: ${error.message}`);

  await supabase.rpc("record_opportunity_history", { p_source: "manual" });
  revalidatePath("/opportunities", "layout");
}

export type ContactMatch = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  account_id: string | null;
  account_name: string | null;
};

/**
 * Doubles as the "new pursuit" typeahead (caller gates that on 2+ characters
 * itself) and the /data/people directory, where an empty query means browse
 * rather than search.
 */
export async function searchCrmContacts(
  query: string,
  letter?: string | null
): Promise<{ results: ContactMatch[]; total: number }> {
  await assertPipeline("view");
  // PostgREST's .or() reads commas/parens as filter syntax, not literal text --
  // stripped here so a name typed as "Smith, John" searches instead of erroring.
  const q = query.trim().replace(/[,()]/g, " ").trim();

  const supabase = await createClient();
  let sel = supabase
    .from("crm_contacts")
    .select("id,first_name,last_name,title,email,account_id,crm_accounts(name)", { count: "exact" });
  if (letter) {
    sel = sel.ilike("last_name", `${letter}%`);
  } else if (q.length >= 2) {
    sel = sel.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);
  }
  const { data, count, error } = await sel.order("last_name", { ascending: true, nullsFirst: false }).limit(50);
  if (error) throw new Error(`Could not search contacts: ${error.message}`);

  const results = (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    first_name: r.first_name as string | null,
    last_name: r.last_name as string | null,
    title: r.title as string | null,
    email: r.email as string | null,
    account_id: r.account_id as string | null,
    account_name: (r.crm_accounts as { name: string } | null)?.name ?? null,
  }));
  return { results, total: count ?? results.length };
}

export type AccountMatch = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
};

/** The /data/companies directory. Same empty-query-browses shape as searchCrmContacts. */
export async function searchCrmAccounts(
  query: string,
  letter?: string | null
): Promise<{ results: AccountMatch[]; total: number }> {
  await assertPipeline("view");
  const q = query.trim().replace(/[,()]/g, " ").trim();

  const supabase = await createClient();
  let sel = supabase.from("crm_accounts").select("id,name,domain,industry,city,state", { count: "exact" });
  if (letter) {
    sel = sel.ilike("name", `${letter}%`);
  } else if (q.length >= 2) {
    sel = sel.or(`name.ilike.%${q}%,domain.ilike.%${q}%`);
  }
  const { data, count, error } = await sel.order("name").limit(50);
  if (error) throw new Error(`Could not search companies: ${error.message}`);

  const results = data as unknown as AccountMatch[];
  return { results, total: count ?? results.length };
}

/**
 * crm_contacts is "read-only in the app on purpose" everywhere else (see
 * lib/integrations/catalogue.ts) -- it's a one-way Salesforce sync, and an
 * edit here can't push back and may get silently overwritten next time that
 * sync runs. Phone/email are the exception: reps need to fix a wrong number
 * before they can dial it, and crm_contacts_manual_write already gates this
 * to org.manage at the RLS layer, so this is exposing a capability that
 * already existed rather than adding a new one. Name and account stay
 * untouched -- those are the identity fields, not operational ones.
 */
export async function updateContact(id: string, patch: { phone?: string | null; email?: string | null }) {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) throw new Error("Forbidden: org.manage required");

  const supabase = await createClient();
  const { error } = await supabase.from("crm_contacts").update(patch).eq("id", id);
  if (error) throw new Error(`Could not update that contact: ${error.message}`);
  revalidatePath("/opportunities", "layout");
}

export async function logOpportunityActivity(input: {
  opportunity_id: string;
  activity_type: "call" | "email" | "task" | "note";
  subject?: string | null;
  body?: string | null;
  direction?: "inbound" | "outbound" | null;
  outcome?: string | null;
}) {
  const { supabase, me } = await ctx();

  const { error } = await supabase.from("opp_activities").insert({ ...input, created_by: me });
  if (error) throw new Error(`Could not log that activity: ${error.message}`);

  revalidatePath("/opportunities", "layout");
}
