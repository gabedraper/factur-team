"use server";

import { tokenFor } from "@/lib/google/auth";
import { createClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

/*
 * Everything that has to be true before the first NPS campaign goes out.
 *
 * Two independent things can stop it, and they fail in ways that look alike
 * from the outside -- "nothing sent" -- so they are asked about separately:
 * whether Google will let the app write mail as each sender, and whether every
 * client has a sender and an address to write to in the first place.
 */

export type SenderCheck = {
  email: string;
  name: string | null;
  clients: number;
  ok: boolean;
  problem: string | null;
};

export type Coverage = {
  activeClients: number;
  withContactEmail: number;
  withTeamLead: number;
  noTeamLead: { id: string; name: string; blocker: string | null }[];
  noContactEmail: { id: string; name: string; blocker: string | null }[];
};

/** Google's failures here are terse; these are what they actually mean. */
function explain(message: string): string {
  if (/unauthorized_client/i.test(message)) {
    return "Delegation does not cover gmail.compose — a Workspace admin needs to add that scope to the service account's client ID.";
  }
  if (/Precondition check failed|invalid_grant/i.test(message)) {
    return "Google won't act as this person — usually the account doesn't exist, is suspended, or is on a domain the delegation doesn't cover.";
  }
  if (/not valid JSON|is not set/i.test(message)) return message;
  return message;
}

/**
 * Can the app write mail as each person who would send a survey?
 *
 * A survey goes out from the client's **team lead**, not from whoever owns the
 * client day to day -- resolved the way the rest of the app resolves it, as the
 * explicit team_lead_id when one is set and the account manager's manager
 * otherwise. Four people cover the whole Active list, which is also why the
 * shared customer-success mailbox never becomes a sender.
 *
 * Deliberately separate from checkGoogleAccess: that one asks about the billing
 * ingest's own list of mailboxes, which is a different set of people. A pass
 * there says nothing about whether a client's account owner can be sent as.
 *
 * Only a token is requested. Nothing is drafted, nothing is sent, and nobody's
 * mailbox is touched -- Google validates the scope when it issues the token, so
 * a refusal here is the answer without any side effect.
 */
export async function checkNpsSenders(): Promise<{
  serviceAccount: string | null;
  problem: string | null;
  senders: SenderCheck[];
}> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return { serviceAccount: null, problem: "Not permitted.", senders: [] };
  }

  let serviceAccount: string | null = null;
  try {
    const raw = process.env.GOOGLE_INGEST_KEY;
    if (!raw) throw new Error("GOOGLE_INGEST_KEY is not set on this deployment");
    serviceAccount = (JSON.parse(raw) as { client_email?: string }).client_email ?? null;
  } catch (e) {
    return {
      serviceAccount: null,
      problem: explain(e instanceof Error ? e.message : "The key could not be read"),
      senders: [],
    };
  }

  // The signed-in person's own connection, not the service key: both routines
  // carry the is_factur_user() gate, which reads the email out of the caller's
  // token. Asked with the service key there is no token to read, so they would
  // answer "not a Factur user" and return nothing. Same trap as getClientHealth.
  const supabase = await createClient();
  const { data } = await supabase.rpc("nps_sender_coverage");
  const rows = (data ?? []) as { email: string; full_name: string | null; clients: number }[];

  const senders = await Promise.all(
    rows.map(async (r) => {
      const problem = await tokenFor("compose", r.email).then(
        () => null,
        (e: unknown) => explain(e instanceof Error ? e.message : "Unknown error")
      );
      return {
        email: r.email,
        name: r.full_name,
        clients: r.clients,
        ok: problem === null,
        problem,
      };
    })
  );

  senders.sort((a, b) => Number(a.ok) - Number(b.ok) || b.clients - a.clients);
  return { serviceAccount, problem: null, senders };
}

/**
 * Who has nobody to ask, and who has nobody to ask on their behalf.
 *
 * The two gaps are named apart because they are fixed in different places: a
 * client with no account manager is assigned on its own settings page, while an
 * account manager with no manager is fixed against that person in People.
 */
export async function npsCoverage(): Promise<Coverage> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return {
      activeClients: 0, withContactEmail: 0, withTeamLead: 0,
      noTeamLead: [], noContactEmail: [],
    };
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("nps_campaign_readiness");
  const rows = (data ?? []) as {
    client_id: string; client_name: string; has_contact_email: boolean;
    has_team_lead: boolean; team_lead: string | null; blocker: string | null;
  }[];

  return {
    activeClients: rows.length,
    withContactEmail: rows.filter((r) => r.has_contact_email).length,
    withTeamLead: rows.filter((r) => r.has_team_lead).length,
    noTeamLead: rows.filter((r) => !r.has_team_lead)
      .map((r) => ({ id: r.client_id, name: r.client_name, blocker: r.blocker })),
    noContactEmail: rows.filter((r) => !r.has_contact_email)
      .map((r) => ({ id: r.client_id, name: r.client_name, blocker: r.blocker })),
  };
}
