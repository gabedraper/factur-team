import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncPeople, backfillOrphanLists, listsDue, syncListAccess } from "@/lib/clickup/access.mjs";

/*
 * Keeping ClickUp access current, a batch at a time.
 *
 * Every list's access is about 1,000 calls, far past this route's 300 seconds,
 * so each run re-reads the lists checked longest ago and stops. Every fifteen
 * minutes that walks the whole workspace every four or five hours: someone
 * added to a list in ClickUp can see it here the same afternoon.
 *
 * People are re-linked every run, because it is one call and a new hire's
 * access depends on it. Lists that tasks point at but the tree never recorded
 * are picked up too -- one SQL query to find, usually none.
 *
 * scripts/sync-clickup-access.mjs does the same for every list at once, by
 * hand. The logic is shared in lib/clickup/access.mjs.
 */

export const maxDuration = 300;

/* Sixty lists and a couple of other calls: comfortably inside ClickUp's 100 a
 * minute, and done in well under a minute. */
const BATCH = 60;

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

  const get = async (path: string) => {
    const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
      headers: { Authorization: token }, cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} on ${path}`);
    return res.json();
  };

  try {
    const people = await syncPeople(db, get);
    const orphans = await backfillOrphanLists(db, get);
    const lists = await listsDue(db, BATCH);
    const { done, failed } = await syncListAccess(db, get, lists);

    return NextResponse.json({
      people: people.length,
      linked: people.filter((p) => p.member_id).length,
      orphans,
      lists: done,
      failed,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
