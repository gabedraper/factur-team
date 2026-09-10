"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import type { Container, ContainerKind, Crumb, ListItem, FieldValue } from "@/lib/work-tree";
import type { WorkItem } from "@/lib/work";

/*
 * Navigating the mirror the way people navigate ClickUp.
 *
 * Space, then folder, then list, in ClickUp's own manual order -- not
 * alphabetically. People drag their sidebar into the shape of their job, and a
 * tree sorted the "correct" way is the kind of small wrongness that makes a
 * replacement feel foreign.
 */

type Row = {
  id: string;
  clickup_id: string;
  kind: ContainerKind;
  name: string;
  task_count: number;
  url: string | null;
  parent_clickup_id: string | null;
};

async function mayView(): Promise<boolean> {
  const perms = await myPermissions();
  return perms.has("work.view") || perms.has("org.manage");
}

/** Open items per list, for the lists being shown. One round trip. */
async function openCounts(listIds: string[]): Promise<Map<string, number>> {
  if (listIds.length === 0) return new Map();
  const { data } = await createServiceClient()
    .from("work_items")
    .select("clickup_list_id")
    .in("clickup_list_id", listIds)
    .in("status_type", ["open", "custom"])
    .limit(50000);

  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { clickup_list_id: string | null }[]) {
    if (r.clickup_list_id) {
      counts.set(r.clickup_list_id, (counts.get(r.clickup_list_id) ?? 0) + 1);
    }
  }
  return counts;
}

async function decorate(rows: Row[]): Promise<Container[]> {
  const listIds = rows.filter((r) => r.kind === "list").map((r) => r.clickup_id);
  const open = await openCounts(listIds);

  return rows.map((r) => ({
    id: r.id,
    clickupId: r.clickup_id,
    kind: r.kind,
    name: r.name,
    taskCount: r.task_count,
    openCount: r.kind === "list" ? open.get(r.clickup_id) ?? 0 : null,
    url: r.url,
  }));
}

/** The top of the tree. */
export async function spaces(): Promise<Container[]> {
  if (!(await mayView())) return [];
  const { data } = await createServiceClient()
    .from("work_containers")
    .select("id,clickup_id,kind,name,task_count,url,parent_clickup_id")
    .eq("kind", "space")
    .eq("archived", false)
    .order("orderindex", { nullsFirst: false })
    .order("name");
  return decorate((data ?? []) as Row[]);
}

/**
 * What sits directly inside a space or folder.
 *
 * Folders first, then lists, each in ClickUp's order -- which is how the
 * sidebar over there reads. A space holds both, because a list may hang off a
 * space with no folder at all.
 */
export async function children(clickupId: string): Promise<Container[]> {
  if (!(await mayView())) return [];
  const { data } = await createServiceClient()
    .from("work_containers")
    .select("id,clickup_id,kind,name,task_count,url,parent_clickup_id")
    .eq("parent_clickup_id", clickupId)
    .eq("archived", false)
    .order("kind", { ascending: true })
    .order("orderindex", { nullsFirst: false })
    .order("name");

  const rows = (data ?? []) as Row[];
  const folders = rows.filter((r) => r.kind === "folder");
  const lists = rows.filter((r) => r.kind === "list");
  return decorate([...folders, ...lists]);
}

/** One container, plus the path back to its space, for the breadcrumb. */
export async function containerWithPath(
  clickupId: string
): Promise<{ node: Container; path: Crumb[] } | null> {
  if (!(await mayView())) return null;
  const db = createServiceClient();

  const { data } = await db
    .from("work_containers")
    .select("id,clickup_id,kind,name,task_count,url,parent_clickup_id")
    .eq("clickup_id", clickupId)
    .maybeSingle();
  if (!data) return null;

  const row = data as Row;
  const [node] = await decorate([row]);

  /* At most two hops -- list to folder to space -- so a loop is cheaper and
   * clearer than a recursive query. */
  const path: Crumb[] = [];
  let parent = row.parent_clickup_id;
  for (let hop = 0; hop < 3 && parent; hop++) {
    const { data: up } = await db
      .from("work_containers")
      .select("clickup_id,kind,name,parent_clickup_id")
      .eq("clickup_id", parent)
      .maybeSingle();
    if (!up) break;
    const u = up as Pick<Row, "clickup_id" | "kind" | "name" | "parent_clickup_id">;
    path.unshift({ clickupId: u.clickup_id, name: u.name, kind: u.kind });
    parent = u.parent_clickup_id;
  }

  return { node, path };
}

/**
 * Every task in one list, with everything a row can show.
 *
 * Dependencies are resolved to titles here rather than in the page: the far end
 * is a ClickUp id, and a row reading "waiting on 86ajwcuxf" helps nobody.
 */
export async function listItems(listClickupId: string): Promise<ListItem[]> {
  if (!(await mayView())) return [];
  const db = createServiceClient();

  const { data } = await db
    .from("work_items")
    .select(`
      id, clickup_id, clickup_url, title, status, status_type, priority,
      start_at, due_at, time_estimate_ms, fields, parent_clickup_id, client_id,
      org_clients(name), work_item_assignees(name),
      work_item_dependencies(depends_on_clickup_id, relation)
    `)
    .eq("clickup_list_id", listClickupId)
    .limit(2000);

  type Row = {
    id: string; clickup_id: string; clickup_url: string; title: string;
    status: string; status_type: ListItem["statusType"]; priority: string | null;
    start_at: string | null; due_at: string | null; time_estimate_ms: number | null;
    fields: FieldValue[] | null; parent_clickup_id: string | null;
    client_id: string | null;
    org_clients: { name: string } | null;
    work_item_assignees: { name: string | null }[];
    work_item_dependencies: { depends_on_clickup_id: string; relation: string }[];
  };

  const rows = (data ?? []) as unknown as Row[];

  /* One lookup for every dependency target across the whole list. */
  const wanted = [...new Set(rows.flatMap((r) =>
    (r.work_item_dependencies ?? []).map((d) => d.depends_on_clickup_id)))];
  const titles = new Map<string, string>();
  if (wanted.length) {
    const { data: others } = await db
      .from("work_items").select("clickup_id,title").in("clickup_id", wanted);
    for (const o of (others ?? []) as { clickup_id: string; title: string }[]) {
      titles.set(o.clickup_id, o.title);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    clickupId: r.clickup_id,
    url: r.clickup_url,
    title: r.title,
    status: r.status,
    statusType: r.status_type,
    priority: r.priority,
    startAt: r.start_at,
    dueAt: r.due_at,
    timeEstimateMs: r.time_estimate_ms,
    assignees: (r.work_item_assignees ?? []).map((a) => a.name ?? "").filter(Boolean),
    fields: r.fields ?? [],
    dependencies: (r.work_item_dependencies ?? []).map((d) => ({
      clickupId: d.depends_on_clickup_id,
      relation: d.relation as "blocking" | "waiting_on",
      title: titles.get(d.depends_on_clickup_id) ?? null,
    })),
    parentClickupId: r.parent_clickup_id,
    clientName: r.org_clients?.name ?? null,
    clientId: r.client_id,
  }));
}
