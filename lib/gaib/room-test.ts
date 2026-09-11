import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { postToSpace } from "./chat-post";
import { ROUTES } from "@/lib/routes.generated";
import { noDashes } from "./vary";

/*
 * One thing to test, each working day, in a testing room.
 *
 * The point of a daily prompt rather than "go and test the app" is that
 * nobody tests "the app". They test the thing they were asked to look at,
 * today, and they only do it if it is small, specific and addressed to them.
 * So each post is one task, for one group, with where to go and what good
 * looks like -- and it asks for the answer back in the room, where Gaib can
 * turn a complaint into a ticket on the spot.
 *
 * What to test is chosen from what actually changed: tickets that shipped in
 * the last fortnight are the best material there is, because somebody asked
 * for each one and nobody has checked it since. When a track has had nothing
 * recent, the picker falls back to that track's everyday screens.
 */

export type Track = {
  /** What people call it, used in the post. */
  name: string;
  /** What falls under it, in plain words, for the picker to choose from. */
  topic: string;
  /** Who to ask. "everyone" mentions the whole room. */
  emails: string[] | "everyone";
};

export type RoomTesting = { tracks: Track[] };

const Pick = z.object({
  subject: z.string().describe("A short name for today's test, used to avoid repeating it."),
  message: z.string().describe(
    "The post itself. Friendly and short: one thing to try, where to find it, what should happen, " +
      "and a closing line asking them to reply here mentioning @Gaib with what they found. " +
      "No headings. Under 90 words. Do not include any names or mentions -- those are added separately."
  ),
});

const PICK_MODEL = "claude-sonnet-5";

/** Which track today belongs to. Rotates, so every group gets its turn. */
function trackFor(tracks: Track[], day: Date): Track {
  const daysSinceEpoch = Math.floor(day.getTime() / 86_400_000);
  return tracks[daysSinceEpoch % tracks.length];
}

/** Mention the people in a track, or everybody. */
async function mentions(track: Track): Promise<string> {
  if (track.emails === "everyone") return "<users/all>";

  const db = createServiceClient();
  const emails = track.emails.map((e) => e.toLowerCase());
  const [{ data: known }, { data: members }] = await Promise.all([
    db.from("gaib_chat_people").select("email,chat_user").in("email", emails),
    db.from("org_members").select("email,full_name").in("email", emails),
  ]);

  const byEmail = new Map(
    ((known ?? []) as { email: string; chat_user: string }[]).map((p) => [p.email, p.chat_user])
  );
  const names = new Map(
    ((members ?? []) as { email: string; full_name: string | null }[])
      .map((m) => [m.email.toLowerCase(), m.full_name])
  );

  /*
   * A mention needs the person's Chat id, which Gaib learns the first time they
   * message it. Until then they are named in plain text -- the post still makes
   * sense, it just does not ping them.
   */
  return emails
    .map((e) => (byEmail.get(e) ? `<${byEmail.get(e)}>` : names.get(e) ?? e.split("@")[0]))
    .join(" ");
}

export type PostResult =
  | { ok: true; track: string; subject: string }
  | { ok: false; reason: string };

/**
 * Choose today's test for one room and post it.
 *
 * Idempotent per room per day: the unique row in gaib_room_tests is written
 * before posting, so a scheduler that fires twice posts once.
 */
export async function postTodaysTest(
  spaceName: string,
  testing: RoomTesting,
  today = new Date()
): Promise<PostResult> {
  if (!testing.tracks?.length) return { ok: false, reason: "no tracks configured" };

  const db = createServiceClient();
  const forDate = today.toISOString().slice(0, 10);

  const { data: already } = await db
    .from("gaib_room_tests").select("id")
    .eq("space_name", spaceName).eq("for_date", forDate).maybeSingle();
  if (already) return { ok: false, reason: "already posted today" };

  const track = trackFor(testing.tracks, today);

  const since = new Date(today.getTime() - 14 * 86_400_000).toISOString();
  const [{ data: shipped }, { data: recent }] = await Promise.all([
    db.from("gaib_tickets")
      .select("ref,title,kind,page_url,closed_at")
      .eq("status", "shipped")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(25),
    db.from("gaib_room_tests")
      .select("subject,for_date")
      .eq("space_name", spaceName)
      .order("for_date", { ascending: false })
      .limit(15),
  ]);

  const shippedList = ((shipped ?? []) as { ref: number; title: string; page_url: string | null }[])
    .map((t) => `- ${t.title}${t.page_url ? ` (${t.page_url})` : ""}`)
    .join("\n") || "- nothing shipped in the last fortnight";

  const recentList = ((recent ?? []) as { subject: string }[])
    .map((r) => `- ${r.subject}`).join("\n") || "- none yet";

  /*
   * In Gabe's voice, like everything else Gaib says. The test post is the one
   * message the whole room reads every morning, so it is the last place to
   * sound like a different person.
   */
  const { data: agent } = await db.from("gaib_agents").select("voice").eq("is_default", true).maybeSingle();
  const voice = (agent as { voice: string | null } | null)?.voice ?? "";

  const client = new Anthropic();
  let pick: z.infer<typeof Pick> | null = null;
  try {
    const res = await client.messages.parse({
      model: PICK_MODEL,
      max_tokens: 1200,
      output_config: { format: zodOutputFormat(Pick) },
      system:
        "You run a small testing programme for Factur's internal web app (team.facturmfg.com). " +
        "Each working day you pick ONE thing for a group of colleagues to try, and post it in their " +
        "shared chat. Pick something concrete and completable in a few minutes, inside the group's area. " +
        "Prefer something that changed recently. Never repeat a recent test. Plain language with no " +
        "technical terms -- these are salespeople and strategists, not engineers. Never use an em dash " +
        "or an en dash, and never open two days' posts the same way." +
        (voice ? `\n\nWrite it in this person's voice:\n\n${voice}` : ""),
      messages: [{
        role: "user",
        content: [
          `Today's group: ${track.name}.`,
          `What their area covers: ${track.topic}`,
          "",
          "Changes shipped in the last fortnight (best material if one fits this group):",
          shippedList,
          "",
          "Tests already posted recently -- do not repeat these:",
          recentList,
          "",
          "Pages the app has, for reference:",
          ROUTES.filter((r) => !r.includes("[")).join(", "),
        ].join("\n"),
      }],
    });
    pick = res.parsed_output ?? null;
  } catch (e) {
    return { ok: false, reason: `could not choose a test: ${e instanceof Error ? e.message : "unknown"}` };
  }
  if (!pick) return { ok: false, reason: "the model returned nothing usable" };

  const text = `${await mentions(track)} today's test (${track.name})\n\n${noDashes(pick.message)}`;

  // Claimed before posting, so a second run the same day finds it and stops.
  const { error: claimError } = await db.from("gaib_room_tests").insert({
    space_name: spaceName,
    for_date: forDate,
    track: track.name,
    subject: pick.subject,
    message: text,
  });
  if (claimError) return { ok: false, reason: "already posted today" };

  const sent = await postToSpace(spaceName, text);
  if (!sent.ok) {
    // Released, so the next run tries again rather than the day being lost.
    await db.from("gaib_room_tests").delete()
      .eq("space_name", spaceName).eq("for_date", forDate);
    return { ok: false, reason: sent.reason };
  }

  return { ok: true, track: track.name, subject: pick.subject };
}
