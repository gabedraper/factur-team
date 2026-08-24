"use server";

import { tokenFor } from "@/lib/google/auth";
import { ingestBillingMail, type IngestReport } from "@/lib/ingest/comms";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

export type AccountCheck = {
  email: string;
  name: string | null;
  why: string;
  ok: boolean;
  problem: string | null;
};

/** Google's failures here are terse; these are what they actually mean. */
function explain(message: string): string {
  if (/unauthorized_client/i.test(message)) {
    return "Delegation not accepted — check the scopes and that the numeric Client ID was used, not the service account's email.";
  }
  if (/Precondition check failed|invalid_grant/i.test(message)) {
    return "Google won't act as this person — usually the account doesn't exist or is suspended.";
  }
  if (/not valid JSON|is not set/i.test(message)) {
    return message;
  }
  return message;
}

/**
 * Ask Google for a read token for each account the ingest would read.
 *
 * Only checks that delegation works. It reads no mail and stores nothing --
 * enough to tell a setup problem from an empty result later, which is the
 * difference between "this is broken" and "there was nothing to find".
 */
export async function checkGoogleAccess(): Promise<{
  ok: boolean;
  serviceAccount: string | null;
  problem: string | null;
  accounts: AccountCheck[];
}> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return { ok: false, serviceAccount: null, problem: "Not permitted.", accounts: [] };
  }

  let serviceAccount: string | null = null;
  try {
    const raw = process.env.GOOGLE_INGEST_KEY;
    if (!raw) throw new Error("GOOGLE_INGEST_KEY is not set on this deployment");
    serviceAccount = (JSON.parse(raw) as { client_email?: string }).client_email ?? null;
  } catch (e) {
    return {
      ok: false,
      serviceAccount: null,
      problem: explain(e instanceof Error ? e.message : "The key could not be read"),
      accounts: [],
    };
  }

  const { data } = await createServiceClient().rpc("get_ingest_accounts");
  const accounts = (data ?? []) as {
    email: string; full_name: string | null; why: string; is_shared_mailbox: boolean;
  }[];

  const results: AccountCheck[] = [];
  for (const a of accounts) {
    try {
      await tokenFor("gmail", a.email);
      results.push({ email: a.email, name: a.full_name, why: a.why, ok: true, problem: null });
    } catch (e) {
      results.push({
        email: a.email, name: a.full_name, why: a.why, ok: false,
        problem: explain(e instanceof Error ? e.message : "Unknown error"),
      });
    }
  }

  results.sort((x, y) => Number(x.ok) - Number(y.ok) || x.email.localeCompare(y.email));

  return {
    ok: results.length > 0 && results.every((r) => r.ok),
    serviceAccount,
    problem: null,
    accounts: results,
  };
}

/**
 * Run the billing-mail ingest by hand.
 *
 * Deliberately manual for now. It reads twenty-two mailboxes and writes what it
 * finds; putting that on a schedule before anyone has seen what it collects
 * would be the wrong order.
 */
export async function runBillingIngest(sinceDays = 90): Promise<{
  ok: boolean;
  problem: string | null;
  reports: IngestReport[];
}> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return { ok: false, problem: "Not permitted.", reports: [] };
  }

  try {
    const reports = await ingestBillingMail(sinceDays);
    return { ok: reports.every((r) => !r.problem), problem: null, reports };
  } catch (e) {
    return {
      ok: false,
      problem: e instanceof Error ? e.message : "The ingest failed",
      reports: [],
    };
  }
}
