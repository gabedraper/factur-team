import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildMatcher } from "@/lib/clickup/match.mjs";
import { packFields, packDependencies } from "@/lib/clickup/fields.mjs";

/*
 * Keeping the ClickUp mirror current, incrementally.
 *
 * The full walk in scripts/sync-clickup.mjs reads 1,020 lists and takes 38
 * minutes, which is fine once and impossible on a schedule -- this runs behind
 * a 300 second cap like every other job here. So it does not walk anything. It
 * asks ClickUp one question: what changed since the newest change we already
 * hold. On a quiet hour that is a single API call and no writes.
 *
 * The watermark is max(updated_at_remote) rather than a stored cursor, so a run
 * that dies halfway is repaired by the next one instead of skipping whatever it
 * was holding. Overlap is harmless: every write is an upsert on the ClickUp id.
 */

export const maxDuration = 300;

/** Pages of 100. Ten is far more change than an hour ever produces. */
const MAX_PAGES = 10;

/* A first run with an empty mirror would try to pull everything through a five
 * minute window and fail. The full script exists for that. */
const COLD_START_DAYS = 7;

type Assignee = { id: number | string; username?: string; email?: string };
type Task = {
  id: string; name?: string; text_content?: string; description?: string;
  status?: { status?: string; type?: string };
  priority?: { priority?: string } | null;
  due_date?: string | null; start_date?: string | null; date_closed?: string | null;
  date_created?: string | null; date_updated?: string | null;
  url?: string; parent?: string | null;
  time_estimate?: number | null; time_spent?: number | null;
  custom_fields?: unknown[]; dependencies?: unknown[];
  assignees?: Assignee[];
  list?: { id?: string; name?: string };
  folder?: { id?: string; name?: string };
  space?: { id?: string };
};

const ms = (v: unknown) => (v ? new Date(Number(v)).toISOString() : null);

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();

  const { data: secret } = await db
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  if (!secret || (secret as { value: string }).value !== offered) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const token = process.env.CLICKUP_TOKEN;
  if (!token) return NextResponse.json({ error: "CLICKUP_TOKEN not set" }, { status: 500 });

  const { data: runRow } = await db
    .from("work_sync_runs").insert({}).select("id").single();
  const runId = (runRow as { id: string } | null)?.id ?? null;

  const fail = async (message: string) => {
    if (runId) {
      await db.from("work_sync_runs")
        .update({ finished_at: new Date().toISOString(), error: message }).eq("id", runId);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  };

  try {
    const api = async (path: string) => {
      const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
        headers: { Authorization: token }, cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status} on ${path}`);
      return res.json();
    };

    const team = (await api("/team")).teams?.[0];
    if (!team) throw new Error("token sees no workspace");

    const { data: newest } = await db
      .from("work_items").select("updated_at_remote")
      .order("updated_at_remote", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();

    const watermark = (newest as { updated_at_remote: string | null } | null)?.updated_at_remote
      ? new Date((newest as { updated_at_remote: string }).updated_at_remote).getTime()
      : Date.now() - COLD_START_DAYS * 86_400_000;

    /* Reference data, same rules the full sync uses. */
    const [{ data: processes }, { data: clients }, { data: aliases }, { data: members },
           { data: spaceRows }] = await Promise.all([
      db.from("work_processes").select("id,slug,match_prefixes,position").eq("active", true).order("position"),
      db.from("org_clients").select("id,name"),
      db.from("client_aliases").select("alias,client_name"),
      db.from("org_members").select("id,email,full_name,active"),
      db.from("work_containers").select("clickup_id,name").eq("kind", "space"),
    ]);

    const matcher = buildMatcher({ clients: clients ?? [], aliases: aliases ?? [] });
    const spaceName = new Map(
      ((spaceRows ?? []) as { clickup_id: string; name: string }[]).map((s) => [s.clickup_id, s.name])
    );

    const byEmail = new Map<string, string>();
    const byFullName = new Map<string, string>();
    for (const m of (members ?? []) as { id: string; email: string | null; full_name: string | null; active: boolean }[]) {
      const e = String(m.email ?? "").toLowerCase();
      if (e && (m.active || !byEmail.has(e))) byEmail.set(e, m.id);
      const n = String(m.full_name ?? "").toLowerCase().trim();
      if (n && (m.active || !byFullName.has(n))) byFullName.set(n, m.id);
    }

    const processFor = (listName: string) => {
      const n = (listName || "").toLowerCase().trim();
      for (const p of (processes ?? []) as { id: string; match_prefixes: string[] }[]) {
        for (const prefix of p.match_prefixes ?? []) if (n.startsWith(prefix)) return p.id;
      }
      return null;
    };
    const podFor = (listName: string) => {
      const m = (listName || "").match(/\/\/\s*([A-Za-z0-9]+)\s*$/);
      return m ? m[1].toUpperCase() : null;
    };

    let seen = 0, written = 0, unmatched = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await api(
        `/team/${team.id}/task?date_updated_gt=${watermark}&subtasks=true` +
        `&include_closed=true&order_by=updated&reverse=true&page=${page}`
      );
      const tasks: Task[] = res.tasks ?? [];
      if (tasks.length === 0) break;
      seen += tasks.length;

      const rows = tasks.map((t) => {
        const listName = t.list?.name ?? "";
        const [clientId, how] = matcher.clientFor(t.folder?.name ?? null, t.name ?? "");
        if (!clientId) unmatched++;
        return {
          clickup_id: t.id,
          clickup_url: t.url || `https://app.clickup.com/t/${t.id}`,
          title: t.name || "(untitled)",
          body: (t.text_content || t.description || "").slice(0, 20000) || null,
          status: t.status?.status || "unknown",
          status_type: ["open", "custom", "done", "closed"].includes(t.status?.type ?? "")
            ? t.status?.type : "custom",
          priority: t.priority?.priority ?? null,
          due_at: ms(t.due_date), start_at: ms(t.start_date), closed_at: ms(t.date_closed),
          created_at_remote: ms(t.date_created), updated_at_remote: ms(t.date_updated),
          process_id: processFor(listName),
          pod: podFor(listName),
          client_id: clientId,
          clickup_space: t.space?.id ? spaceName.get(String(t.space.id)) ?? null : null,
          clickup_folder: t.folder?.name ?? null,
          clickup_list: listName || null,
          clickup_list_id: t.list?.id ? String(t.list.id) : null,
          client_match: how,
          parent_clickup_id: t.parent ?? null,
          time_estimate_ms: t.time_estimate ?? null,
          time_spent_ms: t.time_spent ?? null,
          fields: packFields(t),
          synced_at: new Date().toISOString(),
        };
      });

      const { error } = await db.from("work_items").upsert(rows, { onConflict: "clickup_id" });
      if (error) throw new Error(`upsert: ${error.message}`);
      written += rows.length;

      const { data: ids } = await db.from("work_items")
        .select("id,clickup_id").in("clickup_id", rows.map((r) => r.clickup_id));
      const idFor = new Map(
        ((ids ?? []) as { id: string; clickup_id: string }[]).map((r) => [r.clickup_id, r.id])
      );

      /* Replaced, not merged: a task unassigned in ClickUp must stop looking
       * assigned here. */
      await db.from("work_item_assignees").delete().in("work_item_id", [...idFor.values()]);
      const links = tasks.flatMap((t) =>
        (t.assignees ?? []).map((a) => ({
          work_item_id: idFor.get(t.id),
          clickup_user_id: String(a.id),
          member_id: byEmail.get(String(a.email ?? "").toLowerCase())
            ?? byFullName.get(String(a.username ?? "").toLowerCase().trim()) ?? null,
          name: a.username || a.email || null,
        }))
      ).filter((l) => l.work_item_id);
      if (links.length) await db.from("work_item_assignees").upsert(links);

      await db.from("work_item_dependencies").delete().in("work_item_id", [...idFor.values()]);
      const edges = tasks.flatMap((t) =>
        packDependencies(t).map((e: { depends_on_clickup_id: string; relation: string }) => ({
          work_item_id: idFor.get(t.id),
          depends_on_clickup_id: e.depends_on_clickup_id,
          relation: e.relation,
        }))
      ).filter((e) => e.work_item_id);
      if (edges.length) await db.from("work_item_dependencies").upsert(edges);

      /*
       * A list created since the last full walk has no container row, so it
       * would hold tasks that the tree cannot reach. Rather than re-walk the
       * workspace, the task itself carries enough to place its list: an id, a
       * name, its folder and its space. task_count stays 0 until the next full
       * walk corrects it.
       */
      const listIds = [...new Set(rows.map((r) => r.clickup_list_id).filter(Boolean))] as string[];
      if (listIds.length) {
        const { data: known } = await db
          .from("work_containers").select("clickup_id").in("clickup_id", listIds);
        const have = new Set(((known ?? []) as { clickup_id: string }[]).map((k) => k.clickup_id));
        const missing = tasks.filter(
          (t) => t.list?.id && !have.has(String(t.list.id))
        );
        if (missing.length) {
          const seenList = new Set<string>();
          const newContainers = missing.flatMap((t) => {
            const id = String(t.list!.id);
            if (seenList.has(id)) return [];
            seenList.add(id);
            return [{
              clickup_id: id,
              kind: "list",
              name: t.list?.name ?? "(unnamed)",
              parent_clickup_id: t.folder?.id ? String(t.folder.id) : (t.space?.id ? String(t.space.id) : null),
              space_clickup_id: t.space?.id ? String(t.space.id) : null,
              orderindex: null,
              task_count: 0,
              archived: false,
              statuses: null,
              url: `https://app.clickup.com/${team.id}/v/li/${id}`,
              synced_at: new Date().toISOString(),
            }];
          });
          if (newContainers.length) {
            await db.from("work_containers").upsert(newContainers, { onConflict: "clickup_id" });
          }
        }
      }

      if (res.last_page) break;
    }

    if (runId) {
      await db.from("work_sync_runs").update({
        finished_at: new Date().toISOString(),
        items_seen: seen, items_written: written, unmatched_clients: unmatched,
      }).eq("id", runId);
    }

    return NextResponse.json({ seen, written, unmatched, since: new Date(watermark).toISOString() });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
