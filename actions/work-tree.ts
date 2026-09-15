"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { access, withoutHidden, isHidden, viewer } from "@/lib/work-access";
import { everyRow, inSlices } from "@/lib/supabase/every-row.mjs";
import { clickup } from "@/lib/clickup/api";
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

/**
 * Open items per list, for the lists being shown.
 *
 * Counted in SQL. Pulling the rows and counting them here stopped at the API's
 * 1,000-row page, so a folder with more open work than that under-reported
 * every list in it. No space filter is needed: a list the viewer can see is
 * wholly in a space they can see.
 */
async function openCounts(listIds: string[]): Promise<Map<string, number>> {
  if (listIds.length === 0) return new Map();
  const { data } = await createServiceClient()
    .rpc("work_open_counts_by_list", { p_list_ids: listIds });
  return new Map(
    ((data ?? []) as { list_clickup_id: string; open: number }[]).map((r) => [r.list_clickup_id, Number(r.open)])
  );
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
  const { data } = await withoutHidden(
    createServiceClient()
      .from("work_containers")
      .select("id,clickup_id,kind,name,task_count,url,parent_clickup_id")
      .eq("kind", "space")
      .eq("archived", false),
    await access(),
    "spaces"
  )
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
  const { data } = await withoutHidden(
    createServiceClient()
      .from("work_containers")
      .select("id,clickup_id,kind,name,task_count,url,parent_clickup_id")
      .eq("parent_clickup_id", clickupId)
      .eq("archived", false),
    await access(),
    "containers"
  )
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
    .select("id,clickup_id,kind,name,task_count,url,parent_clickup_id,space_clickup_id")
    .eq("clickup_id", clickupId)
    .maybeSingle();
  if (!data) return null;

  const row = data as Row & { space_clickup_id: string | null };

  /* Not found, rather than forbidden: a page that says "you may not see this"
   * has already told you it exists. */
  if (isHidden(await access(), row)) return null;
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

  /* Paged: the largest lists run past the API's 1,000-row page. */
  const hidden = await access();
  const data = await everyRow(() =>
    withoutHidden(
      db.from("work_items")
        .select(`
          id, clickup_id, clickup_url, title, status, status_type, priority,
          start_at, due_at, time_estimate_ms, fields, parent_clickup_id, client_id,
          org_clients(name), work_item_assignees(name),
          work_item_dependencies(depends_on_clickup_id, relation)
        `)
        .eq("clickup_list_id", listClickupId),
      hidden
    ).order("clickup_id")
  );

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
    const others = await inSlices(wanted, async (slice) => {
      const { data } = await withoutHidden(
        db.from("work_items").select("clickup_id,title").in("clickup_id", slice),
        hidden
      );
      return (data ?? []) as { clickup_id: string; title: string }[];
    });
    for (const o of others) titles.set(o.clickup_id, o.title);
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

/**
 * A new task in one list, written to ClickUp and mirrored straight away.
 *
 * The mirror is read-only everywhere else and that is deliberate -- two sides
 * accepting edits to the same field is a conflict problem nobody asked for.
 * Creating is the exception, and the one people kept leaving for: adding a
 * task meant opening ClickUp, which is how a page meant for working turns
 * into a page you only look at.
 *
 * ClickUp writes first and keeps the identity. The row written here afterwards
 * exists only so the list shows the task before the next sync runs; that sync
 * is what fills in the client match, the process and the fields.
 */
export async function createListTask(input: {
  listClickupId: string;
  title: string;
  description?: string;
  /** A date input's own value, "2026-09-20", or nothing. */
  due?: string;
}): Promise<{ ok: true; clickupId: string } | { ok: false; error: string }> {
  if (!(await mayView())) return { ok: false, error: "Not permitted." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the task a name." };

  const db = createServiceClient();

  /* The list has to be one this person can already open, or this would be a
   * way to write into a space they cannot see. */
  const { data: listData } = await db
    .from("work_containers")
    .select("clickup_id,kind,name,parent_clickup_id,space_clickup_id")
    .eq("clickup_id", input.listClickupId)
    .eq("kind", "list")
    .maybeSingle();
  if (!listData) return { ok: false, error: "List not found." };
  const list = listData as Pick<Row, "clickup_id" | "kind" | "name" | "parent_clickup_id">
    & { space_clickup_id: string | null };
  if (isHidden(await access(), list)) return { ok: false, error: "List not found." };

  /*
   * Created through the one admin token, so ClickUp records that account as
   * the creator rather than whoever asked. Assigning it to the person asking
   * is what keeps the task theirs -- in their queue here, and in ClickUp's
   * own "Me" view over there.
   */
  const { memberId } = await viewer();
  const { data: peopleRow } = memberId
    ? await db.from("work_people").select("clickup_user_id,username")
        .eq("member_id", memberId).limit(1).maybeSingle()
    : { data: null };
  const me = peopleRow as { clickup_user_id: string; username: string | null } | null;

  type Created = {
    id: string; url?: string; date_created?: string | null;
    due_date?: string | null; start_date?: string | null;
    status?: { status?: string; type?: string };
  };
  let task: Created;
  try {
    task = await clickup<Created>(`/list/${list.clickup_id}/task`, {
      name: title,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      /* due_date_time false so ClickUp reads the day in the workspace's own
       * timezone rather than treating midnight UTC as the deadline. */
      ...(input.due ? { due_date: Date.parse(`${input.due}T00:00:00Z`), due_date_time: false } : {}),
      ...(me ? { assignees: [Number(me.clickup_user_id)] } : {}),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  /* The container names, so the row reads correctly in the hour before the
   * sync writes them itself. A folderless list hangs off its space. */
  const upIds = [list.parent_clickup_id, list.space_clickup_id].filter(Boolean) as string[];
  const { data: upRows } = upIds.length
    ? await db.from("work_containers").select("clickup_id,kind,name").in("clickup_id", upIds)
    : { data: [] };
  const up = (upRows ?? []) as { clickup_id: string; kind: string; name: string }[];

  const ms = (v: unknown) => (v ? new Date(Number(v)).toISOString() : null);

  /*
   * updated_at_remote is left unset on purpose. The incremental sync takes
   * max(updated_at_remote) as its watermark and asks ClickUp what changed
   * after it, so filling it in here would push the watermark past this task
   * -- and past anything else changed in the same minute -- and the sync
   * would never come back to finish the row.
   */
  const { data: written } = await db.from("work_items").upsert({
    clickup_id: task.id,
    clickup_url: task.url || `https://app.clickup.com/t/${task.id}`,
    title,
    body: input.description?.trim() || null,
    status: task.status?.status || "unknown",
    status_type: ["open", "custom", "done", "closed"].includes(task.status?.type ?? "")
      ? task.status?.type : "custom",
    due_at: ms(task.due_date), start_at: ms(task.start_date),
    created_at_remote: ms(task.date_created),
    clickup_space: up.find((u) => u.kind === "space")?.name ?? null,
    space_clickup_id: list.space_clickup_id,
    clickup_folder: up.find((u) => u.kind === "folder")?.name ?? null,
    clickup_list: list.name,
    clickup_list_id: list.clickup_id,
    synced_at: new Date().toISOString(),
  }, { onConflict: "clickup_id" }).select("id").maybeSingle();

  const itemId = (written as { id: string } | null)?.id;
  if (itemId && me) {
    await db.from("work_item_assignees").upsert({
      work_item_id: itemId,
      clickup_user_id: me.clickup_user_id,
      member_id: memberId,
      name: me.username,
    });
  }

  return { ok: true, clickupId: task.id };
}
