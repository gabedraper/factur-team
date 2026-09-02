"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions, previewedMemberId } from "@/lib/org";
import { getAuthedUser } from "@/lib/supabase/session";
import type { WorkItem, WorkGroup, SyncState } from "@/lib/work";
import { PRIORITY_ORDER } from "@/lib/work";

/*
 * Reading the ClickUp mirror.
 *
 * Every function here is read-only and always will be: scripts/sync-clickup.mjs
 * is the only writer, and it runs on the service key. If a task needs changing
 * the row carries the URL to go and change it where it lives.
 */

const SELECT = `
  id, clickup_id, clickup_url, title, status, status_type, priority, due_at,
  pod, client_id, clickup_space, clickup_folder, clickup_list,
  work_processes(slug, name, position),
  org_clients(name),
  work_item_assignees(name, member_id)
`;

type Row = {
  id: string;
  clickup_id: string;
  clickup_url: string;
  title: string;
  status: string;
  status_type: WorkItem["statusType"];
  priority: WorkItem["priority"];
  due_at: string | null;
  pod: string | null;
  client_id: string | null;
  clickup_space: string | null;
  clickup_folder: string | null;
  clickup_list: string | null;
  work_processes: { slug: string; name: string; position: number } | null;
  org_clients: { name: string } | null;
  work_item_assignees: { name: string | null; member_id: string | null }[];
};

function toItem(r: Row): WorkItem {
  return {
    id: r.id,
    clickupId: r.clickup_id,
    url: r.clickup_url,
    title: r.title,
    status: r.status,
    statusType: r.status_type,
    priority: r.priority,
    dueAt: r.due_at,
    processName: r.work_processes?.name ?? null,
    processSlug: r.work_processes?.slug ?? null,
    pod: r.pod,
    clientId: r.client_id,
    clientName: r.org_clients?.name ?? null,
    space: r.clickup_space,
    folder: r.clickup_folder,
    list: r.clickup_list,
    assignees: (r.work_item_assignees ?? []).map((a) => a.name ?? "").filter(Boolean),
  };
}

/*
 * Soonest due first, then by priority, then alphabetically. Undated work sinks
 * to the bottom rather than the top: a task with no date is the one nobody has
 * committed to, and it should not be the first thing anybody reads.
 */
function inWorkingOrder(a: WorkItem, b: WorkItem): number {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  if (a.dueAt && !b.dueAt) return -1;
  if (!a.dueAt && b.dueAt) return 1;
  const pa = PRIORITY_ORDER[a.priority ?? "normal"] ?? 2;
  const pb = PRIORITY_ORDER[b.priority ?? "normal"] ?? 2;
  if (pa !== pb) return pa - pb;
  return a.title.localeCompare(b.title);
}

async function mayView(): Promise<boolean> {
  const perms = await myPermissions();
  return perms.has("work.view") || perms.has("org.manage");
}

/**
 * The work on one client, grouped by process.
 *
 * Closed items are left out. The client page is a working screen, and a client
 * three years old would otherwise open with four hundred finished tasks above
 * the eight that matter.
 */
export async function clientWork(clientId: string): Promise<WorkGroup[]> {
  if (!(await mayView())) return [];

  const { data } = await createServiceClient()
    .from("work_items")
    .select(SELECT)
    .eq("client_id", clientId)
    .in("status_type", ["open", "custom"])
    .limit(500);

  const groups = new Map<string, WorkGroup & { position: number }>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const slug = row.work_processes?.slug ?? "other";
    const name = row.work_processes?.name ?? "Other";
    const position = row.work_processes?.position ?? 999;
    if (!groups.has(slug)) groups.set(slug, { slug, name, position, items: [] });
    groups.get(slug)!.items.push(toItem(row));
  }

  return [...groups.values()]
    .sort((a, b) => a.position - b.position)
    .map(({ slug, name, items }) => ({ slug, name, items: items.sort(inWorkingOrder) }));
}

/**
 * Everything assigned to the signed-in person, across every client and process.
 *
 * Respects role preview, because a preview that still shows your own work is
 * not showing you what that person sees.
 */
export async function myWork(): Promise<WorkItem[]> {
  if (!(await mayView())) return [];

  const db = createServiceClient();
  const preview = await previewedMemberId();

  /*
   * The signed-in user comes from the cookie client, not this one: a service
   * client carries no session, so asking it who you are always answers nobody.
   */
  let memberId = preview;
  if (!memberId) {
    const user = await getAuthedUser();
    if (!user) return [];
    const { data: row } = await db
      .from("org_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    memberId = (row as { id: string } | null)?.id ?? null;
  }
  if (!memberId) return [];

  const { data: mine } = await db
    .from("work_item_assignees")
    .select("work_item_id")
    .eq("member_id", memberId)
    .limit(2000);

  const ids = (mine ?? []).map((r) => (r as { work_item_id: string }).work_item_id);
  if (ids.length === 0) return [];

  const { data } = await db
    .from("work_items")
    .select(SELECT)
    .in("id", ids)
    .in("status_type", ["open", "custom"])
    .limit(1000);

  return ((data ?? []) as unknown as Row[]).map(toItem).sort(inWorkingOrder);
}

/**
 * One process across every client -- the view ClickUp cannot give without
 * somebody hand-building it, because the work is spread over 209 folders.
 */
export async function processWork(slug: string): Promise<WorkItem[]> {
  if (!(await mayView())) return [];

  const db = createServiceClient();
  const { data: process } = await db
    .from("work_processes")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!process) return [];

  const { data } = await db
    .from("work_items")
    .select(SELECT)
    .eq("process_id", (process as { id: string }).id)
    .in("status_type", ["open", "custom"])
    .limit(1000);

  return ((data ?? []) as unknown as Row[]).map(toItem).sort(inWorkingOrder);
}

/** What the mirror knows, and when it last knew it. */
export async function syncState(): Promise<SyncState | null> {
  if (!(await mayView())) return null;

  const { data } = await createServiceClient()
    .from("work_sync_runs")
    .select("finished_at,items_written,unmatched_clients,error")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const row = data as {
    finished_at: string | null;
    items_written: number;
    unmatched_clients: number;
    error: string | null;
  };
  return {
    finishedAt: row.finished_at,
    itemsWritten: row.items_written,
    unmatched: row.unmatched_clients,
    error: row.error,
  };
}

/** The processes that actually have open work, for the board picker. */
export async function processesWithWork(): Promise<{ slug: string; name: string; open: number }[]> {
  if (!(await mayView())) return [];

  const db = createServiceClient();
  const [{ data: processes }, { data: items }] = await Promise.all([
    db.from("work_processes").select("id,slug,name,position").eq("active", true).order("position"),
    db.from("work_items").select("process_id").in("status_type", ["open", "custom"]).limit(20000),
  ]);

  const counts = new Map<string, number>();
  for (const i of (items ?? []) as { process_id: string | null }[]) {
    if (i.process_id) counts.set(i.process_id, (counts.get(i.process_id) ?? 0) + 1);
  }

  return ((processes ?? []) as { id: string; slug: string; name: string }[])
    .map((p) => ({ slug: p.slug, name: p.name, open: counts.get(p.id) ?? 0 }))
    .filter((p) => p.open > 0);
}
