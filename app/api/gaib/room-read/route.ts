import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { canPost, listAppRooms } from "@/lib/gaib/chat-post";
import { readRoom } from "@/lib/gaib/room-reader";

/*
 * Every room Gaib is in, read once a minute by pg_cron.
 *
 * Until a Workspace admin approves chat.app.messages.readonly this does
 * nothing but record, per room, that it is waiting -- Google refuses the
 * listing, and a refusal is not an empty room.
 */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();
  const { data: secretRow } = await db
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) return new NextResponse("Unauthorized", { status: 401 });

  if (!canPost()) return NextResponse.json({ rooms: 0, reason: "no posting key configured" });

  /*
   * Whose account resolves a sender's Chat id to an email. The directory
   * lookup uses the domain's public view, so any active member will do; the
   * CEO is simply one who is certain to exist.
   */
  const { data: ceo } = await db
    .from("org_assignments")
    .select("org_roles!inner(name),org_members!inner(email,active)")
    .eq("org_roles.name", "CEO").eq("org_members.active", true)
    .limit(1).maybeSingle();
  const lookupAs = (ceo as { org_members: { email: string } } | null)?.org_members?.email;
  if (!lookupAs) return NextResponse.json({ rooms: 0, reason: "no account to look people up as" });

  // Rooms Gaib has been added to but nobody has spoken to yet.
  for (const room of await listAppRooms()) {
    await db.from("gaib_rooms").upsert(
      { space_name: room.name, display_name: room.displayName },
      { onConflict: "space_name", ignoreDuplicates: false }
    );
  }

  const { data: rooms } = await db.from("gaib_rooms").select("space_name");
  const results = [];
  for (const r of (rooms ?? []) as { space_name: string }[]) {
    results.push(await readRoom(r.space_name, lookupAs).catch((e) => ({
      space: r.space_name,
      status: `failed: ${e instanceof Error ? e.message : "unknown"}`,
      read: 0,
      answered: 0,
    })));
  }

  return NextResponse.json({ rooms: results.length, results });
}
