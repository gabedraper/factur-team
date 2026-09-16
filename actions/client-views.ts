"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentMemberId, myPermissions } from "@/lib/org";
import { CLIENT_FIELD_BY_KEY } from "@/lib/list-views/clients";
import { columnsKnownTo, filtersKnownTo, type Filter, type ListView } from "@/lib/list-views/fields";

/*
 * Saved views for the clients table.
 *
 * The same four calls the opportunities list has, against the same list_views
 * table, scoped to entity 'clients'. They are separate files rather than one
 * generic pair because the two catalogues differ: a column key valid here is
 * meaningless there, and the check that a stored key is real is the whole point
 * of saving through an action instead of writing the row from the browser.
 *
 * RLS already limits a reader to their own views plus the shared ones, and
 * limits writing a shared view to org.manage. The permission check here is
 * about the page, not the row: someone who cannot see clients has no business
 * listing the views of them.
 */

const ENTITY = "clients";
const SELECT = "id,name,owner_member_id,shared,columns,filters,sort_field,sort_dir";

async function mayRead() {
  const perms = await myPermissions();
  return perms.has("clients.health") || perms.has("clients.results") || perms.has("org.manage");
}

export async function listClientViews(): Promise<ListView[]> {
  if (!(await mayRead())) return [];
  const db = await createClient();
  const { data, error } = await db
    .from("list_views")
    .select(SELECT)
    .eq("entity", ENTITY)
    /* Shared first, then a person's own, each alphabetical -- the order
       Salesforce lists them and the order people expect to scan. */
    .order("shared", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ListView[];
}

export async function getClientView(id: string): Promise<ListView | null> {
  if (!(await mayRead())) return null;
  const db = await createClient();
  const { data, error } = await db
    .from("list_views")
    .select(SELECT)
    .eq("id", id)
    .eq("entity", ENTITY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ListView | null) ?? null;
}

export async function saveClientView(input: {
  id?: string;
  name: string;
  shared: boolean;
  columns: string[];
  filters: Filter[];
  sortField: string | null;
  sortDir: "asc" | "desc";
}): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!(await mayRead())) return { success: false, error: "Not permitted." };
  const db = await createClient();

  const name = input.name.trim();
  if (!name) return { success: false, error: "A view needs a name." };

  /* Saved through the same catalogue the table reads, so a view cannot be
     stored naming a column the list could never render. */
  const columns = columnsKnownTo(CLIENT_FIELD_BY_KEY, input.columns).map((f) => f.key);
  if (columns.length === 0) return { success: false, error: "Pick at least one column." };
  const filters = filtersKnownTo(CLIENT_FIELD_BY_KEY, input.filters);

  /* A shared view has no owner and a private one must have one -- the table
     has a check constraint saying exactly that. */
  const owner = input.shared ? null : await currentMemberId();
  if (!input.shared && !owner) return { success: false, error: "No member record for you." };

  const row = {
    name,
    entity: ENTITY,
    shared: input.shared,
    columns,
    filters,
    sort_field: input.sortField,
    sort_dir: input.sortDir,
    owner_member_id: owner,
    updated_at: new Date().toISOString(),
  };

  const res = input.id
    ? await db.from("list_views").update(row).eq("id", input.id).eq("entity", ENTITY).select("id").maybeSingle()
    : await db.from("list_views").insert(row).select("id").maybeSingle();

  if (res.error) return { success: false, error: res.error.message };
  if (!res.data) {
    /* An update that matched nothing is RLS refusing it, not a missing row:
       someone else's view, or a shared one without org.manage. */
    return { success: false, error: "That view belongs to someone else." };
  }
  revalidatePath("/data/clients");
  return { success: true, id: (res.data as { id: string }).id };
}

export async function deleteClientView(id: string): Promise<{ success: boolean; error?: string }> {
  if (!(await mayRead())) return { success: false, error: "Not permitted." };
  const db = await createClient();
  const { error } = await db.from("list_views").delete().eq("id", id).eq("entity", ENTITY);
  if (error) return { success: false, error: error.message };
  revalidatePath("/data/clients");
  return { success: true };
}
