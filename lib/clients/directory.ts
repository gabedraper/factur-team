/*
 * Every client, with the few things about them that live in other tables.
 *
 * Four reads stitched together rather than one query with joins, because
 * org_clients is dropped and recreated by the Coupler sync: it carries no
 * foreign keys for PostgREST to follow, and an embed with no relationship
 * behind it returns empty rather than failing -- which would read as "no
 * account manager" on every row instead of as a bug.
 *
 * Everything is loaded. There are about a thousand clients, the page filters
 * and sorts them in memory, and paging a list this size would cost more in
 * round trips than it saves.
 *
 * "Service" here means the client's most recent service period, not one
 * covering today. Only 18 of 216 current clients have a period that has not
 * ended -- the periods were largely derived from delivered results, so they
 * stop when the results do. Reading them as "what we last sold them" is true;
 * reading them as "what they are on right now" would blank most of the book.
 */

import { createClient } from "@/lib/supabase/server";
import { everyRow } from "@/lib/supabase/every-row.mjs";
import { clientIdsForScope } from "@/lib/list-views/resolve";
import { effectiveTeamLeadId } from "@/lib/team-lead";
import type { ClientRecord } from "@/lib/list-views/clients";

type RawClient = {
  id: string;
  salesforce_client_id: string | null;
  name: string;
  status: string | null;
  email_domain: string | null;
  account_manager_id: string | null;
  team_lead_id: string | null;
  created_at: string | null;
};

type RawMember = {
  id: string;
  full_name: string | null;
  email: string;
  manager_member_id: string | null;
};

type RawPeriod = {
  salesforce_client_id: string;
  service: string | null;
  tier: string | null;
  started_on: string | null;
  ended_on: string | null;
  monthly_rate: number | null;
};

export async function clientDirectory({
  scope,
}: {
  scope: "mine" | "team" | null;
}): Promise<{ rows: ClientRecord[]; error: string | null }> {
  try {
    const db = await createClient();

    let ids: string[] | null = null;
    if (scope) {
      ids = await clientIdsForScope(scope);
      // Staffed on nothing means nothing to show -- never "everything".
      if (ids.length === 0) return { rows: [], error: null };
    }

    const [clients, members, periods] = await Promise.all([
      everyRow<RawClient>(() =>
        db
          .from("org_clients")
          .select("id,salesforce_client_id,name,status,email_domain,account_manager_id,team_lead_id,created_at")
          .order("name")
          .order("id"),
      ),
      everyRow<RawMember>(() =>
        db.from("org_members").select("id,full_name,email,manager_member_id").order("id"),
      ),
      everyRow<RawPeriod>(() =>
        db
          .from("client_service_periods")
          .select("salesforce_client_id,service,tier,started_on,ended_on,monthly_rate")
          .order("salesforce_client_id")
          .order("started_on", { ascending: false }),
      ),
    ]);

    const inScope = ids ? new Set(ids) : null;
    const mine = inScope ? clients.filter((c) => inScope.has(c.id)) : clients;

    const memberById = new Map(members.map((m) => [m.id, m]));
    const nameOf = (id: string | null) => {
      if (!id) return null;
      const m = memberById.get(id);
      return m ? (m.full_name ?? m.email) : null;
    };

    /* The rows arrive newest first per client, so the first one wins. */
    const latestPeriod = new Map<string, RawPeriod>();
    for (const p of periods) {
      if (p.salesforce_client_id && !latestPeriod.has(p.salesforce_client_id)) {
        latestPeriod.set(p.salesforce_client_id, p);
      }
    }

    const rows: ClientRecord[] = mine.map((c) => {
      const period = c.salesforce_client_id ? latestPeriod.get(c.salesforce_client_id) : undefined;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        domain: c.email_domain,
        account_manager: nameOf(c.account_manager_id),
        /* The explicit team lead, or the account manager's own manager -- the
           same rule as org_client_team.effective_team_lead_id. */
        team_lead: nameOf(effectiveTeamLeadId(c, memberById)),
        service: period?.service ?? null,
        tier: period?.tier ?? null,
        service_started: period?.started_on ?? null,
        service_ended: period?.ended_on ?? null,
        monthly_rate: period?.monthly_rate ?? null,
        salesforce_id: c.salesforce_client_id,
        created_at: c.created_at,
      };
    });

    return { rows, error: null };
  } catch (e) {
    /* Returned, never thrown: an empty table that says nothing is how a broken
       query gets reported as "no clients" for a week. */
    return { rows: [], error: e instanceof Error ? e.message : "Could not load clients." };
  }
}

/** The distinct values behind each picklist, taken from the rows on screen. */
export function clientPicklists(rows: ClientRecord[]): Record<string, string[]> {
  const of = (read: (r: ClientRecord) => string | null) =>
    [...new Set(rows.map(read).filter((v): v is string => Boolean(v)))].sort((a, b) =>
      a.localeCompare(b),
    );
  return {
    status: of((r) => r.status),
    account_manager: of((r) => r.account_manager),
    team_lead: of((r) => r.team_lead),
    service: of((r) => r.service),
    tier: of((r) => r.tier),
  };
}
