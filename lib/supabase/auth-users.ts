import type { User } from "@supabase/supabase-js";
import type { createServiceClient } from "@/lib/supabase/server";

/**
 * Every sign-in account, not the first fifty.
 *
 * auth.admin.listUsers() returns one page of 50 unless told otherwise, and
 * says nothing about the rest. There were 53 accounts on 2026-09-11, so three
 * people were already missing their email from every screen that joined on it.
 */
export async function everyAuthUser(db: ReturnType<typeof createServiceClient>): Promise<User[]> {
  const perPage = 1000;
  const out: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listing users failed: ${error.message}`);
    out.push(...data.users);
    if (data.users.length < perPage) return out;
  }
}
