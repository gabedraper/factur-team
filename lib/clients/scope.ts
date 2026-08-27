import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions, currentMemberId } from "@/lib/org";
export type ClientScope = {
  /** The clients this person is named on, in any role. */
  mine: Set<string>;
  /** Whether the All Clients choice is theirs to make. */
  canSeeAll: boolean;
  /** Which of the two a fresh visit lands on. */
  defaultAll: boolean;
};

/*
 * The two leads, which are columns because they are worked out from the
 * reporting line rather than assigned. Every other role now lives in
 * org_client_assignments and is read from there.
 */
const LEAD_COLUMNS = ["team_lead_id", "data_team_lead_id"] as const;

/**
 * Which clients a person sees, and whether they may ask for the rest.
 *
 * An account manager opening Client Health wants their own eight, not all two
 * hundred, so the list is theirs by default and the choice is only offered to
 * someone who leads a team. Administrators are unaffected: they start on all
 * of them, as before.
 *
 * "Mine" means named on the client in any role -- account manager, SDR,
 * strategist, analyst, engineer, or either lead -- rather than account manager
 * alone, since the people on a client are the people who care about it.
 */
export async function clientScope(): Promise<ClientScope> {
  const [perms, memberId] = await Promise.all([myPermissions(), currentMemberId()]);
  const admin = perms.has("org.manage");

  if (!memberId) {
    return { mine: new Set(), canSeeAll: admin, defaultAll: admin };
  }

  const db = createServiceClient();

  const [{ data: led }, { data: assigned }] = await Promise.all([
    db.from("org_clients").select("id")
      .or(LEAD_COLUMNS.map((c) => `${c}.eq.${memberId}`).join(",")),
    db.from("org_client_assignments").select("client_id").eq("member_id", memberId),
  ]);

  const mine = new Set([
    ...((led ?? []) as unknown as { id: string }[]).map((c) => c.id),
    ...((assigned ?? []) as unknown as { client_id: string }[]).map((a) => a.client_id),
  ]);

  // A team lead is someone a client is led by, read from the client record
  // rather than from a permission, so nobody has to grant it person by person.
  const { count } = await db
    .from("org_clients")
    .select("id", { count: "exact", head: true })
    .or(`team_lead_id.eq.${memberId},data_team_lead_id.eq.${memberId}`);

  const leadsATeam = (count ?? 0) > 0;

  return {
    mine,
    canSeeAll: admin || leadsATeam,
    defaultAll: admin,
  };
}
