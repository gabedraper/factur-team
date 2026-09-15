/**
 * Asking ClickUp directly, from the server.
 *
 * The token never leaves the server: every caller is a server action or route,
 * and the browser only ever sees what the page chose to render. Import this
 * only from "use server" modules -- process.env.CLICKUP_TOKEN is not exposed to
 * the client bundle, so a client import would fail loudly rather than leak.
 *
 * Pass a body and it posts. Nothing here reads a task back and writes it
 * again -- the one write is creating something new, which has nothing on the
 * other side to conflict with.
 */
export async function clickup<T = unknown>(path: string, body?: unknown): Promise<T> {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) throw new Error("CLICKUP_TOKEN not set");
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined
      ? { Authorization: token }
      : { Authorization: token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ClickUp ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}
