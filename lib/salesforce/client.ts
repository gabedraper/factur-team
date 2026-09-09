/*
 * Talking to Salesforce as the app rather than as a person.
 *
 * The CLI login we used for the one-time backfill is tied to somebody's session
 * and expires. This uses the Client Credentials flow instead: the Connected App
 * authenticates as itself, acting with the permissions of the Run As user set in
 * Salesforce Setup. Nothing to renew, nobody to be logged in.
 *
 * Worth knowing: the sync sees exactly what that Run As user can see. If
 * opportunities go quietly missing, the sharing rules on that user are the first
 * place to look, not this file.
 */

const LOGIN_URL =
  process.env.SALESFORCE_LOGIN_URL ?? "https://factur.my.salesforce.com";
const API_VERSION = "v62.0";

type Token = { accessToken: string; instanceUrl: string; expiresAt: number };

/*
 * Tokens last a while and every request would otherwise buy a new one. Cached in
 * module scope, which on Vercel means per warm instance -- good enough, since the
 * cost of a miss is one extra round trip.
 */
let cached: Token | null = null;

export async function getSalesforceToken(): Promise<Token> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const id = process.env.SALESFORCE_CLIENT_ID;
  const secret = process.env.SALESFORCE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are not set",
    );
  }

  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    /*
     * "no client credentials user enabled" means the Connected App has no Run As
     * user -- set it under Manage -> Edit Policies -> Client Credentials Flow. It
     * is the one failure here that looks like a credentials problem but is not.
     */
    throw new Error(
      `Salesforce auth failed (${res.status}): ${body.error_description ?? body.error ?? "unknown"}`,
    );
  }

  cached = {
    accessToken: body.access_token,
    instanceUrl: body.instance_url,
    /* Salesforce does not return expires_in for this flow; assume the common two hours. */
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
  return cached;
}

/** One page of SOQL results, following nextRecordsUrl until Salesforce stops. */
export async function soql<T = Record<string, unknown>>(
  query: string,
  { max = 50_000 }: { max?: number } = {},
): Promise<T[]> {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  const rows: T[] = [];
  let url =
    `${instanceUrl}/services/data/${API_VERSION}/query?q=` +
    encodeURIComponent(query);

  while (url && rows.length < max) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Salesforce query failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const page = await res.json();
    rows.push(...page.records);
    url = page.nextRecordsUrl ? `${instanceUrl}${page.nextRecordsUrl}` : "";
  }

  return rows;
}

/*
 * Salesforce hands back an "attributes" object on every record describing its
 * type and URL. It is not data and the mirror has no column for it.
 */
export function stripAttributes<T extends Record<string, unknown>>(row: T) {
  const { attributes: _drop, ...rest } = row as Record<string, unknown>;
  return rest;
}

export const SALESFORCE_API_VERSION = API_VERSION;
