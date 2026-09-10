"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertPipeline } from "@/lib/pipeline/access";
import {
  FIELD_BY_KEY, knownColumns, knownFilters, resolveDate,
  DEFAULT_COLUMNS,
  type Filter, type ListField, type ListView,
} from "@/lib/pipeline/list-views";

/*
 * Reads and writes behind the Salesforce-style Opportunities list.
 *
 * Everything goes through the user-scoped client. RLS on opportunities already
 * limits a viewer to clients they hold a role on, and on
 * opportunity_list_views to their own views plus the shared ones, so neither
 * needs a check here that the database is not already making.
 *
 * No filter or column reaches the query as text. Both are looked up in
 * LIST_FIELDS first, and anything not in that catalogue is dropped -- a saved
 * view naming a column that has since gone simply loses that column.
 */

const PAGE = 50;

/* Which embeds a set of fields needs, and whether a filter forces !inner. */
type Embeds = { contacts: boolean; accounts: boolean; clients: boolean; campaigns: boolean };

function tableOf(f: ListField): keyof Embeds | null {
  const [head] = f.path.split(".");
  if (head === "crm_contacts") return "contacts";
  if (head === "crm_accounts") return "accounts";
  if (head === "org_clients") return "clients";
  if (head === "crm_campaigns") return "campaigns";
  return null;
}

export async function listOpportunities(input: {
  columns: string[];
  filters: Filter[];
  sortField?: string | null;
  sortDir?: "asc" | "desc";
  search?: string;
  clientId?: string | null;
  page?: number;
}): Promise<{ rows: Record<string, unknown>[]; hasMore: boolean; tooBroad: boolean }> {
  await assertPipeline("view");
  const db = await createClient();

  const fields = knownColumns(input.columns.length ? input.columns : DEFAULT_COLUMNS);
  const filters = knownFilters(input.filters ?? []);

  /*
   * An embed is inner-joined only when something filters on it. A left embed
   * with a filter on its column nulls the embed for non-matches instead of
   * dropping the row, which reads as a broken filter; an inner embed on a
   * column nobody filtered would silently hide rows with no contact.
   */
  const needed: Embeds = { contacts: false, accounts: false, clients: false, campaigns: false };
  const inner: Embeds = { contacts: false, accounts: false, clients: false, campaigns: false };

  for (const f of fields) {
    const t = tableOf(f);
    if (t) needed[t] = true;
  }
  for (const f of filters) {
    const field = FIELD_BY_KEY.get(f.field)!;
    const t = tableOf(field);
    if (t) { needed[t] = true; inner[t] = true; }
  }
  /* A filtered embed column is selected too. PostgREST does not require it, but
     an embed selected as just its id while something filters another of its
     columns is the kind of thing that works until it doesn't. */
  const filterPaths = filters.map((f) => FIELD_BY_KEY.get(f.field)!.path);
  if (input.search) { needed.contacts = true; needed.accounts = true; }

  const cols = new Set<string>(["id"]);
  const embedCols: Record<string, Set<string>> = {
    crm_contacts: new Set(), crm_accounts: new Set(), org_clients: new Set(), crm_campaigns: new Set(),
  };
  const add = (path: string) => {
    const [head, col] = path.split(".");
    if (col) embedCols[head]?.add(col);
    else cols.add(head);
  };
  for (const f of fields) {
    add(f.path);
    for (const extra of f.extraSelect ?? []) add(extra);
  }
  for (const p of filterPaths) add(p);
  /* The sort column has to be selected for PostgREST to order by it. */
  const sortField = input.sortField ? FIELD_BY_KEY.get(input.sortField) : null;
  if (sortField) add(sortField.path);

  const parts = [...cols];
  const embedName = (t: keyof Embeds) => ({
    contacts: "crm_contacts", accounts: "crm_accounts",
    clients: "org_clients", campaigns: "crm_campaigns",
  }[t]);
  for (const t of ["contacts", "accounts", "clients", "campaigns"] as (keyof Embeds)[]) {
    if (!needed[t]) continue;
    const name = embedName(t);
    const inside = [...embedCols[name]];
    if (inside.length === 0) inside.push("id");
    parts.push(`${name}${inner[t] ? "!inner" : ""}(${inside.join(",")})`);
  }

  /*
   * No exact count. Counting is the expensive half: PostgREST runs it as a
   * second pass over the whole filtered set, so a view with no filter spends a
   * couple of seconds counting 779,809 rows to put a number above a table
   * showing fifty of them. Fetching one row more than a page tells us whether
   * there is a next page, which is the only thing the number was being used
   * for.
   */
  let q = db.from("opportunities").select(parts.join(","));

  if (input.clientId) q = q.eq("client_id", input.clientId);

  for (const f of filters) {
    const field = FIELD_BY_KEY.get(f.field)!;
    const p = field.path;
    const raw = (f.value ?? "").trim();

    switch (f.op) {
      case "contains":       if (raw) q = q.ilike(p, `%${raw}%`); break;
      case "not_contains":   if (raw) q = q.not(p, "ilike", `%${raw}%`); break;
      case "equals":         if (raw) q = q.eq(p, raw); break;
      case "not_equals":     if (raw) q = q.neq(p, raw); break;
      case "starts_with":    if (raw) q = q.ilike(p, `${raw}%`); break;
      case "not_starts_with": if (raw) q = q.not(p, "ilike", `${raw}%`); break;
      case "is_empty":       q = q.is(p, null); break;
      case "is_not_empty":   q = q.not(p, "is", null); break;
      case "is_true":        q = q.is(p, true); break;
      case "is_false":       q = q.is(p, false); break;
      case "on":             { const d = resolveDate(raw); if (d) q = q.eq(p, d); break; }
      case "before":         { const d = resolveDate(raw); if (d) q = q.lt(p, d); break; }
      case "after":          { const d = resolveDate(raw); if (d) q = q.gt(p, d); break; }
      case "on_or_before":   { const d = resolveDate(raw); if (d) q = q.lte(p, d); break; }
      case "on_or_after":    { const d = resolveDate(raw); if (d) q = q.gte(p, d); break; }
    }
  }

  /* One box across the two things people search by name. */
  if (input.search) {
    const s = input.search.replace(/[%,()]/g, " ").trim();
    if (s) {
      q = q.or(
        `first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`,
        { referencedTable: "crm_contacts" },
      );
    }
  }

  if (sortField) {
    const [head, col] = sortField.path.split(".");
    q = col
      ? q.order(col, { referencedTable: head, ascending: input.sortDir !== "desc", nullsFirst: false })
      : q.order(head, { ascending: input.sortDir !== "desc", nullsFirst: false });
  } else {
    q = q.order("updated_at", { ascending: false });
  }

  const page = Math.max(0, input.page ?? 0);
  const { data, error } = await q.range(page * PAGE, page * PAGE + PAGE);

  if (error) {
    /*
     * 57014 is Postgres cancelling on the statement timeout. It means this view
     * asked for more than the database will do in one request -- almost always
     * a sort on a joined column with nothing narrowing the rows first. The
     * screen says so and asks for a filter rather than showing a broken page.
     */
    const timedOut = error.code === "57014" || /statement timeout|canceling statement/i.test(error.message);
    if (timedOut) return { rows: [], hasMore: false, tooBroad: true };
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > PAGE;
  return { rows: hasMore ? rows.slice(0, PAGE) : rows, hasMore, tooBroad: false };
}


export async function listViews(): Promise<ListView[]> {
  await assertPipeline("view");
  const db = await createClient();
  const { data, error } = await db
    .from("opportunity_list_views")
    .select("id,name,owner_member_id,shared,columns,filters,sort_field,sort_dir")
    /* Shared first, then a person's own, each alphabetical -- the same order
       Salesforce lists them and the order people expect to scan. */
    .order("shared", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ListView[];
}

async function myMemberId(db: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await db.rpc("pipeline_my_scope");
  const row = ((data ?? []) as { member_id: string }[])[0];
  return row?.member_id ?? null;
}

export async function saveView(input: {
  id?: string;
  name: string;
  shared: boolean;
  columns: string[];
  filters: Filter[];
  sortField: string | null;
  sortDir: "asc" | "desc";
}): Promise<{ success: boolean; id?: string; error?: string }> {
  await assertPipeline("view");
  const db = await createClient();

  const name = input.name.trim();
  if (!name) return { success: false, error: "A view needs a name." };

  /* Saved through the same catalogue the reader uses, so a view cannot be
     stored naming something the list could never render. */
  const columns = knownColumns(input.columns).map((f) => f.key);
  if (columns.length === 0) return { success: false, error: "Pick at least one column." };
  const filters = knownFilters(input.filters);

  const owner = input.shared ? null : await myMemberId(db);
  if (!input.shared && !owner) return { success: false, error: "No member record for you." };

  const row = {
    name, shared: input.shared, columns, filters,
    sort_field: input.sortField, sort_dir: input.sortDir,
    owner_member_id: owner, updated_at: new Date().toISOString(),
  };

  const res = input.id
    ? await db.from("opportunity_list_views").update(row).eq("id", input.id).select("id").maybeSingle()
    : await db.from("opportunity_list_views").insert(row).select("id").maybeSingle();

  if (res.error) return { success: false, error: res.error.message };
  revalidatePath("/opportunities/my");
  return { success: true, id: (res.data as { id: string } | null)?.id };
}

export async function deleteView(id: string): Promise<{ success: boolean; error?: string }> {
  await assertPipeline("view");
  const db = await createClient();
  const { error } = await db.from("opportunity_list_views").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/opportunities/my");
  return { success: true };
}
