/**
 * Asking ClickUp directly, from the server.
 *
 * The token never leaves the server: every caller is a server action or route,
 * and the browser only ever sees what the page chose to render. Import this
 * only from "use server" modules -- process.env.CLICKUP_TOKEN is not exposed to
 * the client bundle, so a client import would fail loudly rather than leak.
 */
async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) throw new Error("CLICKUP_TOKEN not set");
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: token,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    /* ClickUp says why in the body -- "Status not found", "Invalid date" --
     * and a person who has just tried to save something needs that sentence,
     * not the number. */
    throw new Error(refusal(await res.text().catch(() => "")) || `ClickUp ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

/* {"err":"Status not found","ECODE":"CAT_014"} is the shape of a refusal. */
function refusal(body: string): string {
  try {
    return String((JSON.parse(body) as { err?: string }).err ?? "");
  } catch {
    return "";
  }
}

export async function clickup<T = unknown>(path: string): Promise<T> {
  return ask<T>(path);
}

/**
 * Changing one thing over there, from here.
 *
 * ClickUp stays the record: an edit is forwarded to it and the answer it gives
 * back is what gets stored, so the two sides never hold different opinions
 * about a task. Only fields the caller names are sent, because a PUT carrying
 * a field ClickUp did not ask to change is how a blank form wipes a task.
 */
export async function clickupPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return ask<T>(path, { method: "PUT", body: JSON.stringify(body) });
}
