"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import { assertPipeline } from "@/lib/pipeline/access";
import { queueEdit, pushEdits, PUSHABLE_FIELDS } from "@/lib/salesforce/writeback";

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

export async function createOpportunity(
  input: OpportunityInput
): Promise<
  { ok: true; id: string; collision: RepCollision | null } | { ok: false; error: string }
> {
  try {
    const { supabase, me } = await ctx();

    const { data: existing } = await supabase
      .from("opportunities")
      .select("id")
      .eq("client_id", input.client_id)
      .eq("contact_id", input.contact_id)
      .maybeSingle();
    if (existing) {
      return { ok: false, error: "This client already has a pursuit open against that contact." };
    }

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
    if (error) return { ok: false, error: `Could not create that opportunity: ${error.message}` };

    await supabase.rpc("record_opportunity_history", { p_source: "manual" });
    revalidatePath("/opportunities", "layout");

    return { ok: true, id: (data as { id: string }).id, collision };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create that opportunity." };
  }
}

/**
 * The same RFQ, pursued by a different client.
 *
 * An RFQ often arrives against a client who cannot make the part while
 * another of ours can, and the only route to the second client was retyping
 * the whole pursuit. So the detail already captured comes across -- the
 * contact, the account, the notes and the running updates -- and the first
 * client's progress does not: stage, lead status, the funnel flags and the
 * dates start where a hand-made pursuit starts, and the owner is left unset
 * so the receiving client's own reach decides whose it is.
 *
 * The two are tied together by a note on each record rather than a column.
 * The activity panel is where the history of a pursuit is read, so that is
 * where "this came from somewhere else" belongs, and it keeps the second from
 * being counted as a lead that arrived on its own.
 */
export async function cloneOpportunity(
  id: string,
  clientId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();

    const { data: source } = await supabase
      .from("opportunities")
      .select(
        "client_id,contact_id,account_id,notes,updates," +
        "org_clients(name),crm_contacts(first_name,last_name),crm_accounts(name)"
      )
      .eq("id", id)
      .maybeSingle();
    if (!source) return { ok: false, error: "That opportunity is no longer there." };
    const from = source as unknown as {
      client_id: string | null;
      contact_id: string | null;
      account_id: string | null;
      notes: string | null;
      updates: string | null;
      org_clients: { name: string } | null;
      crm_contacts: { first_name: string | null; last_name: string | null } | null;
      crm_accounts: { name: string } | null;
    };
    if (from.client_id === clientId) {
      return { ok: false, error: "That is the client this opportunity is already on." };
    }

    // Same duplicate check createOpportunity makes, for the same reason: the
    // receiving client may already be pursuing this contact, and that reads
    // better as a sentence than as a unique-violation.
    if (from.contact_id) {
      const { data: existing } = await supabase
        .from("opportunities")
        .select("id")
        .eq("client_id", clientId)
        .eq("contact_id", from.contact_id)
        .maybeSingle();
      if (existing) {
        return { ok: false, error: "This client already has a pursuit open against that contact." };
      }
    }

    const { data: client } = await supabase.from("org_clients").select("name").eq("id", clientId).single();
    const clientName = (client as { name: string } | null)?.name ?? "";
    const contactName = [from.crm_contacts?.first_name, from.crm_contacts?.last_name].filter(Boolean).join(" ");

    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        client_id: clientId,
        contact_id: from.contact_id,
        account_id: from.account_id,
        notes: from.notes,
        updates: from.updates,
        name: computeOpportunityName(from.crm_accounts?.name ?? null, clientName, contactName),
        close_date: new Date().toISOString().slice(0, 10),
        created_by: me,
        updated_by: me,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: `Could not clone that opportunity: ${error.message}` };
    const cloneId = (data as { id: string }).id;

    /*
     * The trail, written separately on each side and neither of them fatal:
     * activity follows the client it hangs off, so somebody who can copy a
     * pursuit cannot always write against the one they copied it from, and
     * that must not cost them the copy they just made.
     */
    await Promise.all([
      supabase.from("opp_activities").insert({
        opportunity_id: id,
        activity_type: "note",
        subject: `Cloned to ${clientName}`,
        body: `The same RFQ is now open under ${clientName}: /opportunities/${cloneId}`,
        created_by: me,
      }),
      supabase.from("opp_activities").insert({
        opportunity_id: cloneId,
        activity_type: "note",
        subject: `Cloned from ${from.org_clients?.name ?? "another client"}`,
        body: `Copied from the pursuit under ${from.org_clients?.name ?? "another client"}: /opportunities/${id}`,
        created_by: me,
      }),
    ]);

    await supabase.rpc("record_opportunity_history", { p_source: "manual" });
    revalidatePath("/opportunities", "layout");

    return { ok: true, id: cloneId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not clone that opportunity." };
  }
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

export async function updateOpportunity(
  id: string,
  patch: OpportunityUpdate
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();

    /*
     * Read before writing, because the Salesforce push needs what this row
     * held a moment ago: it is how a conflict is spotted (Salesforce holding
     * something that is neither the old value nor the new one means somebody
     * edited it over there). Through the user's own client, so a row they
     * cannot see returns nothing and the update below fails the same way.
     */
    const { data: before } = await supabase
      .from("opportunities")
      .select(["salesforce_opportunity_id", ...PUSHABLE_FIELDS].join(", "))
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase
      .from("opportunities")
      .update({ ...patch, updated_by: me })
      .eq("id", id);
    if (error) return { ok: false, error: `Could not update that opportunity: ${error.message}` };

    await supabase.rpc("record_opportunity_history", { p_source: "manual" });
    revalidatePath("/opportunities", "layout");

    /*
     * Queued here rather than in a trigger on the table: the inbound sync
     * writes to opportunities every three minutes and a trigger cannot tell
     * those writes from a person's, so every sync would bounce straight back
     * at Salesforce. An action knows who is typing.
     *
     * after() runs once the save has already answered -- nobody waits on
     * Salesforce to see their own edit -- and a failure here is logged, never
     * shown: the edit is saved, and the push has its own record and its own
     * retry. The cron sweep catches anything this misses.
     */
    if (before) {
      after(async () => {
        try {
          const { ids } = await queueEdit({
            memberId: me,
            opportunityId: id,
            before: before as unknown as Record<string, unknown>,
            patch: patch as Record<string, unknown>,
          });
          if (ids.length) await pushEdits({ ids });
        } catch (e) {
          console.error("salesforce writeback", e);
        }
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that opportunity." };
  }
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

export async function logOpportunityActivity(input: {
  opportunity_id: string;
  activity_type: "call" | "email" | "task" | "note";
  subject?: string | null;
  body?: string | null;
  direction?: "inbound" | "outbound" | null;
  outcome?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, me } = await ctx();

    const { error } = await supabase.from("opp_activities").insert({ ...input, created_by: me });
    if (error) return { ok: false, error: `Could not log that activity: ${error.message}` };

    revalidatePath("/opportunities", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not log that activity." };
  }
}
