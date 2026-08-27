/*
 * Handing a ticket to the agent that will work on it.
 *
 * The agent runs as a GitHub Actions workflow rather than anywhere in this app.
 * That is not an infrastructure preference, it is where the safety comes from:
 * the runner gets a real checkout, a real build, and a commit history, and the
 * two outcomes we care about -- "this shipped" and "this is waiting for Gabe" --
 * are already first-class things in GitHub rather than states we would have to
 * invent and then keep honest.
 *
 * Only the ticket id and its lane are sent. Everything else the agent needs it
 * reads from the database itself with a service key, which keeps the ticket the
 * single copy of what was asked for. Passing the description through the
 * dispatch as well would create a second copy that can drift from the first.
 */

const WORKFLOW = "gaib.yml";

function repo() {
  const full = process.env.GAIB_REPO ?? "gabedraper/factur-team";
  const [owner, name] = full.split("/");
  if (!owner || !name) throw new Error(`GAIB_REPO is not owner/name: ${full}`);
  return { owner, name };
}

export type DispatchResult =
  | { dispatched: true }
  | { dispatched: false; reason: string };

/**
 * Start the agent on a ticket.
 *
 * Never throws. A ticket that could not be dispatched is still a ticket -- the
 * person who raised it has already been told it was taken, and the worst
 * outcome here is that it sits in the queue until someone runs it by hand. That
 * is a great deal better than the chat turn failing after the ticket was
 * already written.
 */
export async function dispatchAgent(
  ticketId: string,
  lane: "auto" | "approval" | "scoping"
): Promise<DispatchResult> {
  const token = process.env.GAIB_GITHUB_TOKEN;
  if (!token) return { dispatched: false, reason: "GAIB_GITHUB_TOKEN is not set" };

  const { owner, name } = repo();
  const url = `https://api.github.com/repos/${owner}/${name}/actions/workflows/${WORKFLOW}/dispatches`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: process.env.GAIB_BRANCH ?? "main",
        inputs: { ticket_id: ticketId, lane },
      }),
    });

    // 204 with an empty body is the success case here, which is easy to
    // misread as a failure when the response has nothing in it to check.
    if (res.status === 204) return { dispatched: true };
    return {
      dispatched: false,
      reason: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`,
    };
  } catch (e) {
    return { dispatched: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}
