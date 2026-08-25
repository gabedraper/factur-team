import { tokenFor } from "./auth";

export type ChatMessage = {
  id: string;
  spaceName: string;
  spaceLabel: string | null;
  createdAt: Date;
  author: string | null;
  text: string;
};

async function call<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Recent Chat messages from the spaces one person belongs to.
 *
 * Chat has no subject line and no client on the thread, so nothing here can be
 * filtered the way mail is -- the caller decides what is about a client by
 * reading the text. That is why this returns the message rather than searching:
 * the API has no query, only a listing.
 *
 * The space listing is per-person by design. A service account sees only the
 * spaces whoever it is impersonating is actually in, which is also why a space
 * nobody on the ingest list belongs to stays invisible.
 */
export async function fetchChat(
  actAs: string,
  sinceDays: number,
  spaceCap = 60,
  perSpaceCap = 200
): Promise<{ messages: ChatMessage[]; spaces: number }> {
  const token = await tokenFor("chat", actAs);
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();

  const spaces: { name: string; displayName?: string }[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      "https://chat.googleapis.com/v1/spaces?pageSize=100" +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const page = await call<{
      spaces?: { name: string; displayName?: string }[];
      nextPageToken?: string;
    }>(url, token);
    spaces.push(...(page.spaces ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && spaces.length < spaceCap);

  const messages: ChatMessage[] = [];

  for (const space of spaces.slice(0, spaceCap)) {
    let mToken: string | undefined;
    let taken = 0;
    do {
      const url =
        `https://chat.googleapis.com/v1/${space.name}/messages` +
        `?pageSize=100&filter=${encodeURIComponent(`createTime > "${since}"`)}` +
        (mToken ? `&pageToken=${mToken}` : "");

      let page: {
        messages?: {
          name: string; createTime: string; text?: string;
          sender?: { name?: string; displayName?: string };
        }[];
        nextPageToken?: string;
      };
      try {
        page = await call(url, token);
      } catch {
        // A space the API will not list messages for -- an app DM, or one the
        // impersonated user has since left. Skip it rather than lose the rest.
        break;
      }

      for (const m of page.messages ?? []) {
        if (!m.text) continue;
        messages.push({
          id: m.name,
          spaceName: space.name,
          spaceLabel: space.displayName ?? null,
          createdAt: new Date(m.createTime),
          author: m.sender?.displayName ?? m.sender?.name ?? null,
          text: m.text,
        });
        taken++;
      }
      mToken = page.nextPageToken;
    } while (mToken && taken < perSpaceCap);
  }

  return { messages, spaces: spaces.length };
}
