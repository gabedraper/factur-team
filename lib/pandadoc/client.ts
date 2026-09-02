/**
 * Reading signed agreements out of PandaDoc.
 *
 * Read only. Nothing here creates, sends or voids a document -- the app's
 * business with PandaDoc is to know what was agreed, not to agree things.
 */

const BASE = "https://api.pandadoc.com/public/v1";

function key(): string {
  const k = process.env.PANDADOC_API_KEY;
  if (!k) {
    throw new Error(
      "PANDADOC_API_KEY is not set. Add it in Vercel (Settings → Environment " +
        "Variables) and redeploy — environment variables are read at build time."
    );
  }
  return k;
}

async function get(path: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `API-Key ${key()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      throw new Error("PandaDoc rejected the key — it may have been rotated.");
    }
    throw new Error(`PandaDoc ${res.status}: ${detail}`);
  }
  return res;
}

export type DocumentRow = {
  id: string;
  name: string;
  status: string;
  date_completed: string | null;
};

/**
 * One page of completed documents, newest first.
 *
 * The list endpoint's status filter does not take the string form of the
 * status, so completed ones are picked out here rather than asked for.
 */
export async function listCompleted(page: number, count = 100): Promise<DocumentRow[]> {
  const res = await get(`/documents?count=${count}&page=${page}&order_by=-date_created`);
  const body = (await res.json()) as { results?: DocumentRow[] };
  return (body.results ?? []).filter((d) => d.status === "document.completed");
}

export type Details = {
  id: string;
  name: string;
  date_completed: string | null;
  /** Salesforce ids, where the document was raised from Salesforce. */
  opportunityId: string | null;
  accountId: string | null;
  /** Merge fields with their values, keyed by token name. */
  tokens: Record<string, string>;
};

export async function details(id: string): Promise<Details> {
  const res = await get(`/documents/${id}/details`);
  const d = (await res.json()) as {
    id: string;
    name: string;
    date_completed: string | null;
    tokens?: { name?: string; value?: string }[];
    linked_objects?: {
      entity_type?: string;
      entity_id?: string;
      children?: { entity_type?: string; entity_id?: string }[];
    }[];
  };

  let opportunityId: string | null = null;
  let accountId: string | null = null;
  for (const link of d.linked_objects ?? []) {
    if (link.entity_type === "opportunity") opportunityId = link.entity_id ?? null;
    if (link.entity_type === "account") accountId = link.entity_id ?? null;
    for (const child of link.children ?? []) {
      if (child.entity_type === "account") accountId = child.entity_id ?? null;
      if (child.entity_type === "opportunity") opportunityId = child.entity_id ?? null;
    }
  }

  const tokens: Record<string, string> = {};
  for (const t of d.tokens ?? []) {
    if (t.name && t.value !== undefined && t.value !== null && t.value !== "") {
      tokens[t.name] = String(t.value);
    }
  }

  return { id: d.id, name: d.name, date_completed: d.date_completed, opportunityId, accountId, tokens };
}

/** The signed PDF, streamed rather than stored -- see the preview route. */
export async function pdf(id: string): Promise<Response> {
  return get(`/documents/${id}/download`);
}

/** "$72,000.00" and "46,500" are both numbers; anything else is not. */
export function money(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function whole(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** Contract_Start_Date__c comes through ISO; anything else is left alone. */
export function isoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/**
 * What the document was for, taken from its own name.
 *
 * They read "Client - Service - Person" or "Client - Renewal - date", so the
 * middle is the service where there is one. A guess, and only used where the
 * contract carries no service token of its own.
 */
export function serviceFromName(name: string): string | null {
  const parts = name.split(" - ").map((p) => p.trim());
  if (parts.length < 2) return null;
  const middle = parts[1];
  if (!middle || /^\d/.test(middle)) return null;
  return middle;
}
