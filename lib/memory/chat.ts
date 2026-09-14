import { tokenFor } from "@/lib/google/auth";
import { remember, syncState, markSynced } from "./store";

/*
 * Google Chat, one person at a time.
 *
 * Read as each member of staff: every space they are in, every message since
 * the last run. A message is one passage, and the person it was read as joins
 * its audience -- so a space with eight people in it becomes readable by
 * those eight, and a direct message between two stays between the two. Same
 * rule as Drive: you may search what you could already scroll back to.
 *
 * Direct messages with Gaib itself are skipped. They are already in his
 * transcripts, and hearing his own answers back in search would be odd.
 */

const SPACES_PER_RUN = 80;
const MESSAGES_PER_SPACE = 300;

type Space = { name: string; displayName?: string; spaceType?: string; singleUserBotDm?: boolean };
type Message = {
  name: string; createTime: string; text?: string;
  sender?: { name?: string; displayName?: string; type?: string };
  thread?: { name?: string };
};

async function get<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function syncChatFor(email: string, deadline: number): Promise<{ spaces: number; passages: number }> {
  const account = email.toLowerCase();
  const state = await syncState("chat", account);
  let token: string;
  try {
    token = await tokenFor("chat", account);
  } catch (e) {
    await markSynced("chat", account, { error: e instanceof Error ? e.message : "no token" });
    return { spaces: 0, passages: 0 };
  }

  // First run reaches back a year; after that, from the last run.
  const since = state.cursor ?? new Date(Date.now() - 365 * 86400_000).toISOString();
  const runStarted = new Date().toISOString();

  const spaces: Space[] = [];
  try {
    let pageToken: string | undefined;
    do {
      const page = await get<{ spaces?: Space[]; nextPageToken?: string }>(
        `https://chat.googleapis.com/v1/spaces?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
        token
      );
      spaces.push(...(page.spaces ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && spaces.length < SPACES_PER_RUN);
  } catch (e) {
    await markSynced("chat", account, { error: e instanceof Error ? e.message : "listing failed" });
    return { spaces: 0, passages: 0 };
  }

  let passages = 0;
  let touched = 0;
  for (const space of spaces) {
    if (Date.now() > deadline) break;
    if (space.singleUserBotDm) continue;
    touched++;

    const messages: Message[] = [];
    try {
      let pageToken: string | undefined;
      do {
        const page = await get<{ messages?: Message[]; nextPageToken?: string }>(
          `https://chat.googleapis.com/v1/${space.name}/messages?pageSize=100` +
            `&filter=${encodeURIComponent(`createTime > "${since}"`)}` +
            (pageToken ? `&pageToken=${pageToken}` : ""),
          token
        );
        messages.push(...(page.messages ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken && messages.length < MESSAGES_PER_SPACE);
    } catch {
      // A space the API will not list for this person. Skip it, keep going.
      continue;
    }

    const label = space.displayName || (space.spaceType === "DIRECT_MESSAGE" ? "Direct message" : "Group chat");
    passages += await remember(
      messages
        .filter((m) => m.text && m.text.trim().length > 0 && m.sender?.type !== "BOT")
        .map((m) => ({
          source: "chat",
          sourceId: m.name,
          title: label,
          url: `https://chat.google.com/room/${space.name.replace(/^spaces\//, "")}`,
          author: m.sender?.displayName ?? null,
          body: m.text!.trim(),
          audience: [account],
          occurredAt: m.createTime,
        }))
    );
  }

  await markSynced("chat", account, { cursor: runStarted, passages, error: null });
  return { spaces: touched, passages };
}
