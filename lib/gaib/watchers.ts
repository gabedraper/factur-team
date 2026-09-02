import { createServiceClient } from "@/lib/supabase/server";
import { postToSpace, canPost } from "./chat-post";

/*
 * Telling whoever runs Gaib that somebody is talking to it.
 *
 * The point is not surveillance -- the transcripts have been readable all along
 * for the person who holds that permission. The point is timing: a complaint
 * you hear about on Thursday was a complaint you could have answered on Monday,
 * and a question Gaib got wrong is worth knowing about while the person is
 * still sitting there rather than after they have given up on it.
 *
 * Everything here fails silently and separately from the reply. A notification
 * that did not send is a small loss; one that took somebody's answer down with
 * it is not, and the person talking to Gaib has no idea any of this exists.
 */

/** Enough of what they said to know whether it needs you. */
const EXCERPT = 180;

export type IncomingMessage = {
  fromUserId: string;
  fromName: string;
  text: string;
  channel: "app" | "google_chat";
  sessionId: string;
  /** True when this is the first thing said in the conversation. */
  isFirst: boolean;
};

export async function tellWatchers(message: IncomingMessage): Promise<void> {
  try {
    if (!canPost()) return;

    const db = createServiceClient();
    const { data } = await db.rpc("gaib_watchers");
    const watchers = (data ?? []) as { user_id: string; full_name: string; space_name: string }[];
    if (!watchers.length) return;

    const excerpt = message.text.length > EXCERPT
      ? `${message.text.slice(0, EXCERPT).trimEnd()}…`
      : message.text;

    const where = message.channel === "google_chat" ? "in Chat" : "in the app";
    const opener = message.isFirst ? "started a conversation with" : "said to";

    const body = [
      `*${message.fromName}* ${opener} Gaib ${where}:`,
      "",
      `_${excerpt}_`,
      "",
      `https://team.facturmfg.com/gaib/transcripts?s=${message.sessionId}`,
    ].join("\n");

    await Promise.all(
      watchers
        // Nobody needs telling about their own messages. Without this, the
        // person who reads the notifications is also the person generating
        // half of them, and they stop reading.
        .filter((w) => w.user_id !== message.fromUserId)
        .map((w) => postToSpace(w.space_name, body))
    );
  } catch {
    // Never the reason a reply fails.
  }
}
