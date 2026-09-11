import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { canPost } from "@/lib/gaib/chat-post";
import { postTodaysTest, type RoomTesting } from "@/lib/gaib/room-test";

/*
 * The daily test post, for every room that runs a testing programme.
 *
 * Called once each working morning by pg_cron. Safe to call more often: each
 * room posts at most once a day, enforced by a unique row rather than by
 * trusting the schedule.
 */

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // The same shared secret as the other scheduled routes -- this posts to
  // people, and being able to make Gaib do that from outside is not something
  // to leave open.
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();
  const { data: secretRow } = await db
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!canPost()) return NextResponse.json({ posted: 0, reason: "no posting key configured" });

  /*
   * Working days only. A test posted on Saturday is read on Monday alongside
   * Monday's, and the older one is simply skipped -- so the weekend post is
   * wasted and quietly teaches people the daily post is skippable.
   */
  const day = new Date().getUTCDay();
  if (day === 0 || day === 6) return NextResponse.json({ posted: 0, reason: "weekend" });

  const { data: rooms } = await db
    .from("gaib_rooms").select("space_name,testing").not("testing", "is", null);

  const results = [];
  for (const room of (rooms ?? []) as { space_name: string; testing: RoomTesting }[]) {
    results.push({ room: room.space_name, ...(await postTodaysTest(room.space_name, room.testing)) });
  }

  return NextResponse.json({ rooms: results.length, results });
}
