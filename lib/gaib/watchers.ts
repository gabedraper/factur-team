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

/*
 * Two moments, not every message.
 *
 * Every message was the honest reading of "tell me when somebody talks to
 * Gaib", and it does not survive forty people using it -- a hundred pings a day
 * in which the three that matter are indistinguishable from the ninety-seven
 * that do not, and the whole thing gets muted.
 *
 * These two carry nearly all of the value. The opening line of a conversation
 * says who is asking about what, which is the part worth skimming. A raised
 * ticket is somebody's actual problem, which is the part worth acting on.
 * Everything in between is the middle of a conversation you can read later.
 */
export type WatchEvent =
  | {
      kind: "started";
      fromUserId: string;
      fromName: string;
      text: string;
      channel: "app" | "google_chat";
      sessionId: string;
    }
  | {
      kind: "ticket";
      fromUserId: string;
      fromName: string;
      ref: number;
      title: string;
      ticketKind: "bug" | "idea";
      lane: string;
      sessionId: string | null;
    };

const LANE_MEANS: Record<string, string> = {
  auto: "being fixed now",
  approval: "waiting for you",
  scoping: "being scoped, then waiting for you",
};

export async function tellWatchers(event: WatchEvent): Promise<void> {
  try {
    if (!canPost()) return;

    const db = createServiceClient();
    const { data } = await db.rpc("gaib_watchers");
    const watchers = (data ?? []) as { user_id: string; full_name: string; space_name: string }[];
    if (!watchers.length) return;

    const body = event.kind === "started"
      ? [
          `*${event.fromName}* asked Gaib ` +
            `${event.channel === "google_chat" ? "in Chat" : "in the app"}:`,
          "",
          `_${event.text.length > EXCERPT
              ? `${event.text.slice(0, EXCERPT).trimEnd()}…`
              : event.text}_`,
          "",
          `https://team.facturmfg.com/gaib/transcripts?s=${event.sessionId}`,
        ].join("\n")
      : [
          `*${event.fromName}* reported ${event.ticketKind === "bug" ? "a bug" : "an idea"} ` +
            `— Gaib ${event.ref}, ${LANE_MEANS[event.lane] ?? event.lane}:`,
          "",
          `_${event.title}_`,
          "",
          `https://team.facturmfg.com/gaib`,
        ].join("\n");

    await Promise.all(
      watchers
        // Nobody needs telling about their own messages. Without this, the
        // person who reads the notifications is also the person generating
        // half of them, and they stop reading.
        .filter((w) => w.user_id !== event.fromUserId)
        .map((w) => postToSpace(w.space_name, body))
    );
  } catch {
    // Never the reason a reply fails.
  }
}
