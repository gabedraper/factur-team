import { createClient } from "@/lib/supabase/server";
import { currentMemberId } from "@/lib/org";
import {
  ENTITIES, LIVE_CLIENT_STATUSES, systemViews, viewKey,
  type ResolvedView,
} from "./catalogue";

/**
 * Assembles the view list for one page: the ones defined in code, one per live
 * client, the ones this person has saved, and their own hiding and ordering
 * laid over the top.
 *
 * Everything is read in a single round of parallel queries. This runs on every
 * list page, so it must not become the reason a list is slow.
 */

export type ViewList = {
  /** Shown as chips. Kept short on purpose. */
  pinned: ResolvedView[];
  /** Everything else, for the picker. 215 live clients will not fit in a row. */
  rest: ResolvedView[];
};

type PrefRow = { view_key: string; hidden: boolean; pinned: boolean; position: number | null };
type SavedRow = { id: string; name: string; client_id: string | null; position: number };
type ClientRow = { id: string; name: string };

export async function resolveViews(entityKey: string): Promise<ViewList> {
  const entity = ENTITIES[entityKey];
  if (!entity) return { pinned: [], rest: [] };

  const db = await createClient();
  const memberId = await currentMemberId();

  const [clientsRes, savedRes, prefsRes] = await Promise.all([
    /*
     * Scoped views come from here rather than from stored rows, which is what
     * makes them free: a client that goes Inactive drops out of this query and
     * its views vanish with it. Nothing to delete, nothing to backfill.
     */
    /* Per-client views need a route to a client, and are pointless on the
       clients list itself -- "Acme's clients" would be one row, Acme. */
    entity.clientPath && entity.myScope !== "is_client"
      ? db.from("org_clients").select("id,name")
          .in("status", LIVE_CLIENT_STATUSES as unknown as string[])
          .order("name")
      : Promise.resolve({ data: [] as ClientRow[] }),
    db.from("list_views").select("id,name,client_id,position")
      .eq("entity", entityKey)
      // Your own, plus anything shared with everyone.
      .or(memberId ? `owner_member_id.eq.${memberId},shared.is.true` : "shared.is.true"),
    memberId
      ? db.from("list_view_prefs").select("view_key,hidden,pinned,position")
          .eq("member_id", memberId).eq("entity", entityKey)
      : Promise.resolve({ data: [] as PrefRow[] }),
  ]);

  const prefs = new Map<string, PrefRow>();
  for (const p of (prefsRes.data ?? []) as PrefRow[]) prefs.set(p.view_key, p);

  const views: ResolvedView[] = [...systemViews(entity)];

  for (const c of (clientsRes.data ?? []) as ClientRow[]) {
    views.push({
      key: viewKey.scopedClient(c.id),
      label: c.name,
      kind: "scoped",
      params: { client: c.id },
      // Not pinned by default. 215 clients as chips would bury the two views
      // somebody actually opens every day.
      pinned: false,
      hidden: false,
      position: 100,
    });
  }

  for (const s of (savedRes.data ?? []) as SavedRow[]) {
    views.push({
      key: viewKey.saved(s.id),
      label: s.name,
      kind: "saved",
      params: { view: s.id },
      pinned: true,
      hidden: false,
      position: 50 + s.position,
    });
  }

  /*
   * A person's own decisions win over every default above, including on views
   * that are not stored anywhere -- which is the reason view_key is a string
   * rather than a foreign key.
   */
  const withPrefs = views.map((v) => {
    const p = prefs.get(v.key);
    if (!p) return v;
    return {
      ...v,
      hidden: p.hidden,
      pinned: p.pinned,
      position: p.position ?? v.position,
    };
  });

  const visible = withPrefs
    .filter((v) => !v.hidden)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));

  return {
    pinned: visible.filter((v) => v.pinned),
    rest: visible.filter((v) => !v.pinned),
  };
}

/**
 * The client ids a scope resolves to.
 *
 * Both functions already exist in the database and both gate on the session,
 * so the answer cannot be widened by passing a different member id from here.
 * `my_client_ids()` walks the reporting line downward; the `_direct` variant
 * does not.
 */
export async function clientIdsForScope(
  scope: "mine" | "team",
  { liveOnly = false }: { liveOnly?: boolean } = {},
): Promise<string[]> {
  /*
   * The session client, never the service one. Both functions resolve who is
   * asking from auth.uid(); called with the service key there is no user, so
   * they would return nothing at all and every "My ..." view would come back
   * empty with no error to say why.
   */
  const db = await createClient();
  const fn = scope === "team" ? "my_client_ids" : "my_client_ids_direct";
  const [scoped, live] = await Promise.all([
    db.rpc(fn),
    liveOnly
      ? db.from("org_clients").select("id").in("status", LIVE_CLIENT_STATUSES as unknown as string[])
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (scoped.error) throw new Error(`${fn}: ${scoped.error.message}`);
  if (live.error) throw new Error(`live clients: ${live.error.message}`);
  const ids = ((scoped.data ?? []) as { client_id: string }[]).map((r) => r.client_id);
  if (!liveOnly) return ids;
  /*
   * Callers put these ids in a query string, and the API gateway refuses one
   * past roughly 15k characters -- about 400 ids. A manager at the top of the
   * reporting line reaches nearly every client ever staffed, close to a
   * thousand, so "My team's" failed outright for exactly the people most
   * likely to open it. Live clients are 215, and an inactive client's views
   * are hidden anyway.
   */
  const liveIds = new Set(((live.data ?? []) as { id: string }[]).map((r) => r.id));
  return ids.filter((id) => liveIds.has(id));
}
