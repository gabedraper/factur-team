import { createServiceClient } from "@/lib/supabase/server";
import { soql } from "@/lib/salesforce/client";

/*
 * Counts Salesforce against the mirror and the app, and learns deletions.
 *
 * Run hourly by the cron job and on demand from the settings page. Kept out
 * of the route so the page's "Check now" runs the same code.
 */

type Local = { object: string; scope: string; mirror_count: number; app_count: number; note: string | null };

/* Salesforce writes timestamps as 2026-09-09T11:22:33.000+0000. */
function soqlTime(iso: string) {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function reconcileSalesforce(): Promise<{
  checkedAt: string;
  rows: number;
  deleted: { opportunities: number; quotes: number; orders: number };
}> {
  const db = createServiceClient();
  const checkedAt = new Date().toISOString();

  /* Salesforce's side. The stage aggregate over 2.4M rows takes about seven
     seconds; the totals are instant. */
  const [byStage, quotes, orders, contacts, accounts] = await Promise.all([
    soql<{ StageName: string | null; n: number }>(
      "SELECT StageName, COUNT(Id) n FROM Opportunity GROUP BY StageName",
    ),
    soql<{ n: number }>("SELECT COUNT(Id) n FROM Quote"),
    soql<{ n: number }>("SELECT COUNT(Id) n FROM Order"),
    soql<{ n: number }>("SELECT COUNT(Id) n FROM Contact"),
    soql<{ n: number }>("SELECT COUNT(Id) n FROM Account"),
  ]);
  const sf = new Map<string, number>();
  let oppTotal = 0;
  for (const r of byStage) {
    sf.set(`Opportunity|${r.StageName ?? ""}`, Number(r.n));
    oppTotal += Number(r.n);
  }
  sf.set("Opportunity|__all", oppTotal);
  sf.set("Quote|__all", Number(quotes[0]?.n ?? 0));
  sf.set("Order|__all", Number(orders[0]?.n ?? 0));
  sf.set("Contact|__all", Number(contacts[0]?.n ?? 0));
  sf.set("Account|__all", Number(accounts[0]?.n ?? 0));

  /* Our side, counted the same way every time. */
  const { data: localRows, error } = await db.rpc("reconciliation_local_counts");
  if (error) throw new Error(`local counts failed: ${error.message}`);
  const local = (localRows ?? []) as Local[];

  const seen = new Set<string>();
  const out = local.map((l) => {
    const key = `${l.object}|${l.scope}`;
    seen.add(key);
    return {
      checked_at: checkedAt,
      object: l.object,
      scope: l.scope,
      sf_count: sf.get(key) ?? (l.object === "Opportunity" ? 0 : null),
      mirror_count: l.mirror_count,
      app_count: l.app_count,
      note: l.note,
    };
  });
  /* Stages Salesforce has that we hold none of. */
  for (const [key, n] of sf) {
    if (seen.has(key)) continue;
    const [object, scope] = key.split("|");
    out.push({ checked_at: checkedAt, object, scope, sf_count: n, mirror_count: 0, app_count: 0, note: null });
  }
  const { error: insErr } = await db.from("salesforce_reconciliation").insert(out);
  if (insErr) throw new Error(`recording counts failed: ${insErr.message}`);

  /*
   * Deletions since the last check (or thirty days on the first). The ids
   * are the whole answer; the database does the rest.
   */
  const { data: last } = await db
    .from("salesforce_reconciliation").select("checked_at")
    .lt("checked_at", checkedAt).order("checked_at", { ascending: false }).limit(1).maybeSingle();
  const since = (last as { checked_at: string } | null)?.checked_at
    ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const deletedIds = async (object: string) =>
    (await soql<{ Id: string }>(
      `SELECT Id FROM ${object} WHERE IsDeleted = true AND LastModifiedDate > ${soqlTime(since)}`,
      { includeDeleted: true, max: 20_000 },
    )).map((r) => r.Id);
  const [dOpp, dQuote, dOrder] = await Promise.all([
    deletedIds("Opportunity"), deletedIds("Quote"), deletedIds("Order"),
  ]);
  const { data: applied } = await db.rpc("apply_salesforce_deletions", {
    p_opportunities: dOpp, p_quotes: dQuote, p_orders: dOrder,
  });
  const d = (applied ?? { opportunities: 0, quotes: 0, orders: 0 }) as {
    opportunities: number; quotes: number; orders: number;
  };

  return { checkedAt, rows: out.length, deleted: d };
}
