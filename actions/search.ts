"use server";

import { createClient } from "@/lib/supabase/server";
import { talentAccess } from "@/lib/talent/access";
import {
  SEARCH_OBJECTS, OBJECT_LABEL,
  type SearchGroup, type SearchHit, type SearchObject, type SearchScope,
} from "@/lib/search/objects";

/*
 * The header search, and the results page behind it.
 *
 * Deliberately ignores views. Every list searches inside the view it has open,
 * so a record the view left out could not be found anywhere; this looks across
 * everything the viewer is allowed to see.
 *
 * One search_records() call per object, in parallel -- "All" costs as long as
 * the slowest object rather than the sum of them. Each object fails on its
 * own: one broken query reports itself in its own group and the rest still
 * answer.
 */

export async function searchableObjects(): Promise<SearchObject[]> {
  const talent = await talentAccess();
  return SEARCH_OBJECTS.filter((o) => o.needs !== "talent" || talent.view).map((o) => o.key);
}

export async function searchRecords(input: {
  q: string;
  scope: SearchScope;
  limit?: number;
}): Promise<SearchGroup[]> {
  const q = input.q.trim();
  if (q.length < 2) return [];

  const allowed = await searchableObjects();
  const objects = input.scope === "all" ? allowed : allowed.filter((o) => o === input.scope);
  const limit = Math.max(1, Math.min(input.limit ?? 5, 100));

  const db = await createClient();
  return Promise.all(
    objects.map(async (object): Promise<SearchGroup> => {
      const { data, error } = await db.rpc("search_records", { p_object: object, p_q: q, p_limit: limit });
      if (error) {
        return { object, hits: [], more: false, error: `Could not search ${OBJECT_LABEL[object].toLowerCase()}.` };
      }
      /* The function returns one row past the limit so "more" costs no count. */
      const rows = (data ?? []) as SearchHit[];
      return { object, hits: rows.slice(0, limit), more: rows.length > limit };
    }),
  );
}
