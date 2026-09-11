/*
 * Reading who ClickUp lets see what, for work_people and work_list_access.
 *
 * Shared by scripts/sync-clickup-access.mjs (all lists, by hand) and
 * app/api/work/access-sync (a small batch every fifteen minutes). Both pass in
 * their own database client and their own `get`, because the script paces
 * itself against ClickUp's rate limit and the route is small enough not to.
 */
import { everyRow } from "../supabase/every-row.mjs";

const lower = (s) => String(s ?? "").toLowerCase().trim();

/**
 * Every ClickUp user, linked to a person here by email, then by full name.
 * A hand-set link (match = 'manual') is never overwritten.
 */
export async function syncPeople(db, get) {
  const team = (await get("/team")).teams?.[0];
  const users = (team?.members ?? []).map((m) => m.user).filter(Boolean);

  const [members, existing] = await Promise.all([
    everyRow(() => db.from("org_members").select("id,email,full_name,active").order("id")),
    everyRow(() => db.from("work_people").select("clickup_user_id,member_id,match").order("clickup_user_id")),
  ]);

  /* Active wins where an address or a name appears twice; a name shared by two
   * different people is not used at all. */
  const byEmail = new Map();
  const nameCount = new Map();
  const byName = new Map();
  for (const m of members) {
    const e = lower(m.email);
    if (e && (m.active || !byEmail.has(e))) byEmail.set(e, m.id);
    const n = lower(m.full_name);
    if (!n) continue;
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    if (m.active || !byName.has(n)) byName.set(n, m.id);
  }
  const manual = new Map(existing.filter((r) => r.match === "manual").map((r) => [r.clickup_user_id, r.member_id]));

  const rows = users.map((u) => {
    const id = String(u.id);
    const base = { clickup_user_id: id, email: u.email ?? null, username: u.username ?? null,
                   role: u.role ?? null, synced_at: new Date().toISOString() };
    if (manual.has(id)) return { ...base, member_id: manual.get(id), match: "manual" };
    let memberId = byEmail.get(lower(u.email)) ?? null;
    let how = memberId ? "email" : null;
    if (!memberId) {
      const n = lower(u.username);
      if (n && nameCount.get(n) === 1) { memberId = byName.get(n); how = "name"; }
    }
    return { ...base, member_id: memberId, match: how };
  });

  const { error } = await db.from("work_people").upsert(rows, { onConflict: "clickup_user_id" });
  if (error) throw new Error("people upsert: " + error.message);
  return rows;
}

/*
 * Lists that tasks point at but the tree never recorded -- archived lists, in
 * the first case found: the tree walk asks for unarchived lists only, while
 * tasks keep the list they were filed in. Without a container a list has no
 * access rows, and its tasks fall outside every access decision.
 */
export async function backfillOrphanLists(db, get, log = () => {}) {
  /* Asked of SQL: one array back, rather than every task's list id paged
   * through the API every fifteen minutes. */
  const { data, error } = await db.rpc("work_orphan_list_ids");
  if (error) throw new Error(error.message);
  const orphans = data ?? [];

  for (const id of orphans) {
    try {
      const l = await get(`/list/${id}`);
      /* A folderless list comes back inside a hidden folder; its real parent is
       * the space. */
      const parent = l.folder && !l.folder.hidden ? l.folder.id : l.space?.id;
      await db.from("work_containers").upsert({
        clickup_id: String(l.id), kind: "list", name: l.name ?? "(unnamed)",
        parent_clickup_id: parent ? String(parent) : null,
        space_clickup_id: l.space?.id ? String(l.space.id) : null,
        orderindex: Number.isFinite(Number(l.orderindex)) ? Number(l.orderindex) : null,
        task_count: Number(l.task_count ?? 0), archived: Boolean(l.archived),
        statuses: l.statuses ?? null, synced_at: new Date().toISOString(),
      }, { onConflict: "clickup_id" });
      log(`  + ${l.name}${l.archived ? " (archived)" : ""}`);
    } catch (e) {
      log(`  ! ${id}: ${e.message}`);
    }
  }
  return orphans.length;
}

/**
 * The lists most in need of a re-read: never read first, then oldest. Archived
 * lists included -- their tasks are still in the mirror.
 */
export async function listsDue(db, limit) {
  const { data, error } = await db.from("work_containers")
    .select("clickup_id,name")
    .eq("kind", "list")
    .order("access_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Who ClickUp says can open each list, from /list/{id}/member -- effective
 * access, however they came by it. Replaced wholesale per list: someone removed
 * in ClickUp has to lose it here, and there is no way to know which rows went.
 */
export async function syncListAccess(db, get, lists, log = () => {}) {
  let done = 0, failed = 0;
  for (const l of lists) {
    try {
      const res = await get(`/list/${l.clickup_id}/member`);
      const ids = [...new Set((res.members ?? []).map((m) => String(m.id)))];
      await db.from("work_list_access").delete().eq("list_clickup_id", l.clickup_id);
      if (ids.length) {
        const { error } = await db.from("work_list_access")
          .insert(ids.map((u) => ({ list_clickup_id: l.clickup_id, clickup_user_id: u })));
        if (error) throw new Error(error.message);
      }
      await db.from("work_containers").update({ access_synced_at: new Date().toISOString() })
        .eq("clickup_id", l.clickup_id);
      done++;
    } catch (e) {
      failed++;
      log(`  ! ${l.name} (${l.clickup_id}): ${e.message}`);
    }
  }
  return { done, failed };
}
