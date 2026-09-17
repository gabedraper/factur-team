import { createServiceClient } from "@/lib/supabase/server";

/*
 * Whose Dialpad number this is, from the rotation pool.
 *
 * Deliberately stops there: resolving the *other* party on a call or text to
 * a CRM contact/client is a bigger, cross-cutting question -- one already
 * being built as part of a unified activity ingest elsewhere -- so this
 * stores Dialpad's own contact name as a display fallback and leaves real
 * identity resolution to that project rather than inventing a second,
 * competing version of it here.
 */
export async function memberHolding(e164: string | null): Promise<string | null> {
  if (!e164) return null;
  const db = createServiceClient();
  const { data } = await db.from("voice_numbers")
    .select("assigned_member_id").eq("e164", e164).maybeSingle();
  return (data as { assigned_member_id: string | null } | null)?.assigned_member_id ?? null;
}
