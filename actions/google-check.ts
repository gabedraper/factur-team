"use server";

import { tokenFor } from "@/lib/google/auth";
import {
  ingestBillingMailFor, ingestChatFor, ingestTranscriptsFor,
  type IngestReport,
} from "@/lib/ingest/comms";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

export type AccountCheck = {
  email: string;
  name: string | null;
  why: string;
  ok: boolean;
  problem: string | null;
  /** Which of the three reads Google will allow for this person. */
  scopes: { mail: boolean; chat: boolean; drive: boolean };
};

/** Google's failures here are terse; these are what they actually mean. */
function explain(message: string): string {
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    return "Google issued a token but won't allow this read — the scope is missing from the delegation. Re-paste all four scopes in the Admin console.";
  }
  if (/PERMISSION_DENIED|\b403\b/i.test(message)) {
    return "Google refused the read. Usually the API is switched off for the domain, or the scope is missing from the delegation.";
  }
  if (/\b404\b/i.test(message)) {
    return "Google has nothing here for this person.";
  }
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

  /*
   * Each scope is granted separately in the Admin console, so each is asked
   * for separately. One token for all three would pass on the day Gmail was
   * authorised and hide that Chat and Drive were not -- which shows up later
   * as a pull that fails for every account with an error about a client id.
   */
  const results: AccountCheck[] = [];
  for (const a of accounts) {
    const [mail, chat, drive] = await Promise.all(
      (["gmail", "chat", "drive"] as const).map((svc) =>
        tokenFor(svc, a.email).then(
          () => null,
          (e: unknown) => (e instanceof Error ? e.message : "Unknown error")
        )
      )
    );

    /*
     * Say which read failed, not just that one did.
     *
     * Naming them matters because the three fail independently: two working
     * and one missing is a scope that was never granted, while all three
     * failing the same way is the delegation itself. A single blanket message
     * sent you to the wrong place.
     */
    const failed = ([
      ["Mail", mail], ["Chat", chat], ["Drive", drive],
    ] as [string, string | null][])
      .filter((f) => f[1] !== null)
      .map(([label, m]) => [label, m as string] as const);
    const allSameWay = failed.length === 3 && new Set(failed.map((f) => f[1])).size === 1;

    results.push({
      email: a.email,
      name: a.full_name,
      why: a.why,
      ok: failed.length === 0,
      problem: allSameWay
        ? explain(failed[0][1])
        : failed.length
          ? failed.map(([label, m]) => `${label} — ${explain(m)}`).join(" ")
          : null,
      scopes: { mail: !mail, chat: !chat, drive: !drive },
    });
  }

  results.sort((x, y) => Number(x.ok) - Number(y.ok) || x.email.localeCompare(y.email));

  return {
    ok: results.length > 0 && results.every((r) => r.ok),
    serviceAccount,
    problem: null,
    accounts: results,
  };
}

/** The mailboxes the ingest would read, so the browser can work through them. */
export async function listIngestAccounts(): Promise<string[]> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return [];

  const { data } = await createServiceClient().rpc("get_ingest_accounts");
  return ((data ?? []) as { email: string }[]).map((a) => a.email).sort();
}

/**
 * Read one mailbox.
 *
 * One per call on purpose. Doing all twenty-two in a single request took five
 * minutes and was killed by the function timeout, which the browser reports as
 * the page failing to load -- indistinguishable from a crash. A mailbox at a
 * time finishes well inside the limit, shows progress as it goes, and a failure
 * on one account no longer loses the other twenty-one.
 */
export async function runBillingIngestFor(
  account: string,
  sinceDays = 90
): Promise<IngestReport> {
  return runIngest("mail", account, sinceDays);
}

/**
 * Read one account, for one of the three places the talk happens.
 *
 * Split the same way as mail and for the same reason: a whole domain in one
 * request outruns the function timeout. Chat and Drive are slower per account
 * than Gmail is, so this matters more, not less.
 */
export async function runIngest(
  kind: IngestReport["kind"],
  account: string,
  sinceDays = 90
): Promise<IngestReport> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return {
      account, kind, matching: 0, found: 0, attached: 0,
      byDomain: 0, byThread: 0, byName: 0,
      hitCap: false, problem: "Not permitted.",
    };
  }

  const report =
    kind === "chat"
      ? await ingestChatFor(account, sinceDays)
      : kind === "meetings"
        ? await ingestTranscriptsFor(account, sinceDays)
        : await ingestBillingMailFor(account, sinceDays);

  // Google's own wording is a wall of JSON in a table cell.
  const result = report.problem ? { ...report, problem: explain(report.problem) } : report;

  /*
   * Written down as each account finishes.
   *
   * The sweep is driven from the browser, one account per call, so closing the
   * tab ends it -- and until this was recorded, it ended silently: coming back
   * showed an empty screen whether it had read three accounts or all
   * twenty-three. Now the page can say where it got to, and pick up the rest.
   */
  await createServiceClient()
    .from("ingest_runs")
    .upsert(
      {
        kind, account,
        ran_at: new Date().toISOString(),
        matching: result.matching,
        found: result.found,
        attached: result.attached,
        by_domain: result.byDomain,
        by_thread: result.byThread,
        by_name: result.byName,
        hit_cap: result.hitCap,
        problem: result.problem,
      },
      { onConflict: "kind,account" }
    );

  return result;
}

/** What the last sweep of each kind managed, so the page survives a reload. */
export async function recentIngestRuns(): Promise<(IngestReport & { ranAt: string })[]> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) return [];

  const { data } = await createServiceClient()
    .from("ingest_runs")
    .select("*")
    .order("account");

  return ((data ?? []) as Record<string, never>[]).map((r) => ({
    account: r.account as unknown as string,
    kind: r.kind as unknown as IngestReport["kind"],
    matching: r.matching as unknown as number,
    found: r.found as unknown as number,
    attached: r.attached as unknown as number,
    byDomain: r.by_domain as unknown as number,
    byThread: r.by_thread as unknown as number,
    byName: r.by_name as unknown as number,
    hitCap: r.hit_cap as unknown as boolean,
    problem: r.problem as unknown as string | null,
    ranAt: r.ran_at as unknown as string,
  }));
}
