"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { hiddenSpaceIds, withoutHidden } from "@/lib/work-access";
import { clickup } from "@/lib/clickup/api";
import { displayValue } from "@/lib/clickup/fields.mjs";
import type { TaskDetail, Person, RelatedTask, Comment, CommentSegment } from "@/lib/work-detail";
import { initials } from "@/lib/work-detail";

/*
 * One task, rebuilt for its detail page.
 *
 * Two sources, deliberately. The mirror decides whether you may see it and what
 * it links to in this app -- the client, the process. ClickUp supplies what the
 * bulk sync cannot: comments, attachments, and every custom field including
 * the empty ones, which the page shows because ClickUp does.
 *
 * The mirror is asked first, and a task it does not hold, or holds in a space
 * you are not in, is simply not found. That is what stops this page becoming a
 * way to read any task the token can see.
 */

/* Long enough that a refresh or a second viewer is free, short enough that a
 * comment posted a minute ago is not missing for long. */
const FRESH_MS = 5 * 60_000;
const MAX_REPLY_THREADS = 5;

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const iso = (v: unknown) => (v ? new Date(Number(v)).toISOString() : null);

function person(u: Raw | null | undefined): Person | null {
  if (!u) return null;
  const name = String(u.username ?? u.email ?? "").trim();
  if (!name) return null;
  return { name, initials: u.initials ?? initials(name), color: u.color ?? null };
}

function segments(comment: Raw): CommentSegment[] {
  const parts = (comment.comment ?? []) as Raw[];
  if (parts.length === 0) return [{ kind: "text", text: String(comment.comment_text ?? "") }];
  return parts.map((p): CommentSegment => {
    if (p.type === "tag" || p.type === "mention") return { kind: "mention", text: String(p.text ?? "") };
    const a = (p.attributes ?? {}) as Raw;
    return {
      kind: "text",
      text: String(p.text ?? ""),
      bold: Boolean(a.bold),
      italic: Boolean(a.italic),
      code: Boolean(a.code),
      link: typeof a.link === "string" ? a.link : undefined,
    };
  });
}

function toComment(c: Raw, replies: Raw[] = []): Comment {
  return {
    id: String(c.id),
    author: person(c.user) ?? { name: "Unknown", initials: "?", color: null },
    at: iso(c.date) ?? new Date(0).toISOString(),
    segments: segments(c),
    replies: replies.map((r) => toComment(r)),
    replyCount: Number(c.reply_count ?? 0),
  };
}

async function fetchLive(clickupId: string): Promise<{ task: Raw; comments: Raw[] }> {
  const [task, commentRes] = await Promise.all([
    clickup<Raw>(`/task/${clickupId}?include_subtasks=true&include_markdown_description=true`),
    clickup<Raw>(`/task/${clickupId}/comment`),
  ]);
  const comments = (commentRes.comments ?? []) as Raw[];

  /* Threads are one call each, so only the first few are expanded. */
  const threaded = comments.filter((c) => Number(c.reply_count ?? 0) > 0).slice(0, MAX_REPLY_THREADS);
  const replies = await Promise.all(
    threaded.map((c) =>
      clickup<Raw>(`/comment/${c.id}/reply`).then((r) => [c.id, r.comments ?? []] as const).catch(() => [c.id, []] as const)
    )
  );
  const byId = new Map(replies);
  for (const c of comments) c.__replies = byId.get(c.id) ?? [];

  return { task, comments };
}

export async function taskDetail(clickupId: string): Promise<TaskDetail | null> {
  const perms = await myPermissions();
  if (!perms.has("work.view") && !perms.has("org.manage")) return null;

  const db = createServiceClient();
  const hidden = await hiddenSpaceIds();

  const { data: mirrorRow } = await withoutHidden(
    db.from("work_items")
      .select(`
        clickup_id, clickup_url, title, status, status_type, priority,
        start_at, due_at, closed_at, created_at_remote, updated_at_remote,
        time_estimate_ms, time_spent_ms, body, fields, parent_clickup_id,
        clickup_space, space_clickup_id, clickup_folder, clickup_list, clickup_list_id,
        client_id, org_clients(name), work_processes(name),
        work_item_assignees(name)
      `)
      .eq("clickup_id", clickupId),
    hidden
  ).maybeSingle();
  if (!mirrorRow) return null;
  const m = mirrorRow as Raw;

  /* ---- ClickUp, through a short cache ---------------------------------- */
  let task: Raw | null = null;
  let comments: Raw[] = [];
  let fetchedAt: string | null = null;
  let stale = false;

  const { data: cached } = await db
    .from("work_item_details").select("task,comments,fetched_at").eq("clickup_id", clickupId).maybeSingle();
  const c = cached as { task: Raw; comments: Raw[]; fetched_at: string } | null;

  if (c && Date.now() - new Date(c.fetched_at).getTime() < FRESH_MS) {
    ({ task, comments } = c);
    fetchedAt = c.fetched_at;
  } else {
    try {
      ({ task, comments } = await fetchLive(clickupId));
      fetchedAt = new Date().toISOString();
      await db.from("work_item_details").upsert({ clickup_id: clickupId, task, comments, fetched_at: fetchedAt });
    } catch {
      /* ClickUp unreachable or rate limited: an old answer beats no answer,
       * and the page says it is old. With nothing cached the mirror alone
       * still renders most of the page. */
      if (c) { ({ task, comments } = c); fetchedAt = c.fetched_at; }
      stale = true;
    }
  }

  /* ---- Relations, resolved through the mirror so hidden stays hidden ----- */
  const relIds = new Set<string>();
  const waitingIds: string[] = [];
  const blockingIds: string[] = [];
  for (const d of (task?.dependencies ?? []) as Raw[]) {
    if (d.task_id === clickupId && d.depends_on) waitingIds.push(String(d.depends_on));
    else if (d.depends_on === clickupId && d.task_id) blockingIds.push(String(d.task_id));
  }
  if (!task) {
    const { data: edges } = await db
      .from("work_item_dependencies")
      .select("depends_on_clickup_id, relation, work_items!inner(clickup_id)")
      .eq("work_items.clickup_id", clickupId);
    for (const e of (edges ?? []) as Raw[]) {
      (e.relation === "waiting_on" ? waitingIds : blockingIds).push(e.depends_on_clickup_id);
    }
  }
  const linkedIds = ((task?.linked_tasks ?? []) as Raw[]).map((l) =>
    String(l.task_id === clickupId ? l.link_id : l.task_id));
  [...waitingIds, ...blockingIds, ...linkedIds].forEach((id) => relIds.add(id));
  if (m.parent_clickup_id) relIds.add(m.parent_clickup_id);

  const known = new Map<string, RelatedTask>();
  if (relIds.size) {
    const { data: rel } = await withoutHidden(
      db.from("work_items").select("clickup_id,title,status,status_type").in("clickup_id", [...relIds]),
      hidden
    );
    for (const r of (rel ?? []) as Raw[]) {
      known.set(r.clickup_id, { clickupId: r.clickup_id, title: r.title, status: r.status, statusType: r.status_type });
    }
  }
  let hiddenRelations = 0;
  const resolve = (ids: string[]) =>
    ids.flatMap((id) => {
      const hit = known.get(id);
      if (!hit) { hiddenRelations++; return []; }
      return [hit];
    });

  const waitingOn = resolve(waitingIds);
  const blocking = resolve(blockingIds);
  const linked = resolve(linkedIds);

  /* Subtasks from the mirror: same list, same access, and they carry our
   * assignee matching rather than ClickUp's raw ids. */
  const { data: subRows } = await withoutHidden(
    db.from("work_items")
      .select("clickup_id,title,status,status_type,due_at,work_item_assignees(name)")
      .eq("parent_clickup_id", clickupId),
    hidden
  ).order("created_at_remote", { ascending: true });

  /* ---- Fields: all of them from ClickUp, or the set ones from the mirror -- */
  const fields = task
    ? ((task.custom_fields ?? []) as Raw[]).map((f) => ({ name: String(f.name ?? ""), display: displayValue(f) }))
    : ((m.fields ?? []) as Raw[]).map((f) => ({ name: String(f.name), display: String(f.display ?? "") }));

  const mirrorAssignees = ((m.work_item_assignees ?? []) as Raw[])
    .map((a) => person({ username: a.name })).filter(Boolean) as Person[];

  return {
    clickupId,
    url: m.clickup_url,
    title: task?.name ?? m.title,
    status: task?.status?.status ?? m.status,
    statusType: task?.status?.type ?? m.status_type,
    statusColor: task?.status?.color ?? null,
    priority: task?.priority?.priority ?? m.priority ?? null,
    priorityColor: task?.priority?.color ?? null,

    createdAt: iso(task?.date_created) ?? m.created_at_remote,
    updatedAt: iso(task?.date_updated) ?? m.updated_at_remote,
    closedAt: iso(task?.date_closed) ?? m.closed_at,
    startAt: iso(task?.start_date) ?? m.start_at,
    dueAt: iso(task?.due_date) ?? m.due_at,

    timeEstimateMs: task?.time_estimate ?? m.time_estimate_ms ?? null,
    timeSpentMs: task?.time_spent ?? m.time_spent_ms ?? null,

    creator: person(task?.creator),
    assignees: task ? ((task.assignees ?? []) as Raw[]).map(person).filter(Boolean) as Person[] : mirrorAssignees,
    watchers: ((task?.watchers ?? []) as Raw[]).map(person).filter(Boolean) as Person[],
    tags: ((task?.tags ?? []) as Raw[]).map((t) => ({ name: String(t.name), color: t.tag_bg ?? null })),

    description: String(task?.markdown_description ?? task?.text_content ?? m.body ?? ""),
    fields,
    checklists: ((task?.checklists ?? []) as Raw[]).map((cl) => ({
      name: String(cl.name ?? "Checklist"),
      items: ((cl.items ?? []) as Raw[]).map((i) => ({ name: String(i.name ?? ""), resolved: Boolean(i.resolved) })),
    })),
    attachments: ((task?.attachments ?? []) as Raw[])
      .filter((a) => !a.deleted && !a.hidden)
      .map((a) => ({
        title: String(a.title ?? "attachment"),
        url: String(a.url ?? ""),
        thumbnail: a.thumbnail_medium ?? a.thumbnail_small ?? null,
        extension: a.extension ?? null,
        size: typeof a.size === "number" ? a.size : null,
        at: iso(a.date),
      })),

    parent: m.parent_clickup_id ? known.get(m.parent_clickup_id) ?? null : null,
    subtasks: ((subRows ?? []) as Raw[]).map((s) => ({
      clickupId: s.clickup_id, title: s.title, status: s.status, statusType: s.status_type,
      dueAt: s.due_at,
      assignees: ((s.work_item_assignees ?? []) as Raw[]).map((a) => a.name).filter(Boolean),
    })),
    waitingOn, blocking, linked, hiddenRelations,

    comments: comments
      .map((cm) => toComment(cm, cm.__replies ?? []))
      .sort((a, b) => a.at.localeCompare(b.at)),

    path: {
      spaceId: m.space_clickup_id, space: m.clickup_space,
      folder: m.clickup_folder,
      listId: m.clickup_list_id, list: m.clickup_list,
    },

    clientId: m.client_id,
    clientName: m.org_clients?.name ?? null,
    processName: m.work_processes?.name ?? null,

    fetchedAt, stale,
  };
}
