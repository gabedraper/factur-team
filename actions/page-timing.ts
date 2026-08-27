"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/session";

/**
 * Record one page view.
 *
 * Called from the browser on every navigation, so it does as little as it can
 * and never throws: a page that failed to report how slow it was must not also
 * break for the person it was slow for.
 */

/** A path with the ids taken out, so one page is one row rather than hundreds. */
function shape(path: string): string {
  return path
    .split("/")
    .map((part) => {
      if (!part) return part;
      // Ids, whatever shape they come in -- uuids, numbers, Salesforce keys.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part)) return "[id]";
      if (/^\d+$/.test(part)) return "[id]";
      if (/^[a-zA-Z0-9]{15,18}$/.test(part) && /\d/.test(part)) return "[id]";
      return part;
    })
    .join("/");
}

export async function recordPageView(
  path: string,
  kind: "load" | "route",
  durationMs: number
): Promise<void> {
  try {
    if (!path.startsWith("/")) return;
    // A number this large is a tab left open in the background, not a wait
    // anybody sat through; it would drag an average around on its own.
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 120_000) return;

    const user = await getAuthedUser();
    const db = createServiceClient();

    let memberId: string | null = null;
    if (user) {
      const { data } = await db
        .from("org_members")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      memberId = (data as { id: string } | null)?.id ?? null;
    }

    await db.from("page_views").insert({
      path: shape(path),
      member_id: memberId,
      kind,
      duration_ms: Math.round(durationMs),
    });
  } catch {
    // Deliberately silent. This is instrumentation; it has no business
    // surfacing anything to somebody who was only trying to open a page.
  }
}
