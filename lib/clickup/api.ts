/**
 * Asking ClickUp directly, from the server.
 *
 * The token never leaves the server: every caller is a server action or route,
 * and the browser only ever sees what the page chose to render. Import this
 * only from "use server" modules -- process.env.CLICKUP_TOKEN is not exposed to
 * the client bundle, so a client import would fail loudly rather than leak.
 */
export async function clickup<T = unknown>(path: string): Promise<T> {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) throw new Error("CLICKUP_TOKEN not set");
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    headers: { Authorization: token },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ClickUp ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}
