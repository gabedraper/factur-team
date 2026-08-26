import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions, currentMemberId } from "@/lib/org";
import { CLIENT_ROLE_FIELDS } from "@/lib/client-roles";

export type ClientScope = {
  /** The clients this person is named on, in any role. */
  mine: Set<string>;
  /** Whether the All Clients choice is theirs to make. */
  canSeeAll: boolean;
  /** Which of the two a fresh visit lands on. */
  defaultAll: boolean;
};

/*
 * Every column that names a person on a client, plus the two leads. The role
 * fields are shared with Settings; the leads are not in that list because they
 * are not editable there.
 */
const MINE_COLUMNS = [
  ...CLIENT_ROLE_FIELDS.map((f) => f.key),
  "team_lead_id",
  "data_team_lead_id",
] as const;

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
  const { data } = await db
    .from("org_clients")
    .select("id")
    .or(MINE_COLUMNS.map((c) => `${c}.eq.${memberId}`).join(","));

  const mine = new Set(((data ?? []) as unknown as { id: string }[]).map((c) => c.id));

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
