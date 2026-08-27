"use server";

import { createServiceClient } from "@/lib/supabase/server";
import type { HistorySpan } from "@/lib/client-history";

/*
 * Reading the history that record_client_history writes.
 *
 * The recording side has been running since it shipped; this is the side that
 * lets anyone see it. Kept read-only on purpose -- history is written by
 * reconciling against reality, never typed in, or it would stop being a record
 * of what happened and become a record of what someone remembered.
 */

type Row = {
  id: string;
  field: string;
  value_text: string | null;
  valid_from: string;
  valid_to: string | null;
  source: string;
  org_members: { full_name: string | null; email: string } | null;
};

export async function clientHistory(clientId: string): Promise<HistorySpan[]> {
  const { data } = await createServiceClient()
    .from("client_history")
    .select("id,field,value_text,valid_from,valid_to,source,org_members(full_name,email)")
    .eq("client_id", clientId)
    .order("valid_from", { ascending: false });

  return ((data ?? []) as unknown as Row[])
    /*
     * A span that opened and closed in the same instant describes a state that
     * never actually held -- two edits inside one transaction. It is noise in a
     * timeline, and no point-in-time query can ever return it.
     */
    .filter((r) => r.valid_to !== r.valid_from)
    .map((r) => ({
      id: r.id,
      field: r.field,
      value: r.org_members
        ? r.org_members.full_name ?? r.org_members.email
        : r.value_text,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      source: r.source,
    }));
}
