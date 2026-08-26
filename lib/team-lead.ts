/**
 * Who leads a client: the explicit team lead when one is set, and otherwise the
 * account manager's own manager.
 *
 * The same rule as `public.org_client_team.effective_team_lead_id`, which is the
 * canonical definition -- change both together. It is repeated here rather than
 * read from that view because the view carries an `is_factur_user()` gate that
 * reads the caller's token, and the settings pages load with the service key,
 * which has no token for it to read.
 *
 * Its own file, and structurally typed, so a client component can call it:
 * lib/org.ts reaches next/headers through the Supabase server client, and
 * anything importing a *value* from there cannot run in the browser. Same split
 * as lib/clients/health.ts and health-score.ts.
 *
 * Note that "covered by" on a client is a different question. That is who works
 * the account day to day, and it can be a pod or a shared mailbox; this is the
 * person above them.
 */
export function effectiveTeamLeadId(
  client: { team_lead_id: string | null; account_manager_id: string | null },
  membersById: Map<string, { manager_member_id: string | null }>
): string | null {
  if (client.team_lead_id) return client.team_lead_id;
  if (!client.account_manager_id) return null;
  return membersById.get(client.account_manager_id)?.manager_member_id ?? null;
}
