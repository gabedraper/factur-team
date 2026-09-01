import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { postToSpace, spaceFor, canPost } from "@/lib/gaib/chat-post";
import { phrase, type Notice } from "@/lib/gaib/notices";
import { embedded } from "@/lib/gaib/embedded";

/*
 * Delivering the updates people are owed, without waiting for them to look.
 *
 * The updates themselves have existed for days: a ticket changes status, a row
 * is written, and the next time somebody opens the panel they are told. That
 * works and it is slow -- somebody who reported a broken page on Monday and does
 * not open Gaib again until Thursday learns on Thursday that it was fixed on
 * Monday afternoon, by which point the fixing has stopped feeling like an
 * answer to anything.
 *
 * This pushes them instead, to whoever has a Chat conversation to push to. It
 * changes nothing for anybody who does not: their update stays exactly where it
 * was, waiting in the panel, and is marked delivered by whichever of the two
 * gets to them first.
 */

export const maxDuration = 60;

/** Never more than this in one run. A backlog is a queue, not an avalanche. */
const PER_RUN = 40;

export async function POST(request: NextRequest) {
  /*
   * A shared secret, because this posts to people. Anybody who could trigger it
   * at will could not read anything or change anything -- but they could make
   * Gaib message the company repeatedly, and being able to do that from outside
   * is not something to leave lying around.
   *
   * Read from the database rather than from the environment. The schedule that
   * calls this lives in the database too, so both ends can reach one row --
   * whereas an environment variable would have to be copied to both and kept in
   * step by somebody remembering to. The environment is still honoured as a
   * fallback, for triggering a run by hand.
   */
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const { data: secretRow } = await createServiceClient()
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();

  const expected = (secretRow as { value: string } | null)?.value
    ?? process.env.GAIB_DELIVER_SECRET;

  if (!expected || offered !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!canPost()) {
    return NextResponse.json({ delivered: 0, reason: "no posting key configured" });
  }

  const db = createServiceClient();

  const { data } = await db
    .from("gaib_ticket_notices")
    .select("id,user_id,to_status,note,gaib_tickets(ref,title,kind)")
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(PER_RUN);

  type Ticket = { ref: number; title: string; kind: "bug" | "idea" };
  type Row = {
    id: string; user_id: string; to_status: string; note: string | null;
    gaib_tickets: Ticket | Ticket[] | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  const delivered: string[] = [];
  const skipped: string[] = [];
  // Counted rather than dropped in silence. A row that goes nowhere and is
  // reported nowhere is how the whole feature stayed broken without a trace.
  const orphaned: string[] = [];
  const failed: string[] = [];

  for (const row of rows) {
    const ticket = embedded(row.gaib_tickets);
    if (!ticket) {
      orphaned.push(row.id);
      continue;
    }

    const space = await spaceFor(row.user_id);
    if (!space) {
      // Perfectly ordinary. They have never messaged Gaib, so there is nowhere
      // to put this and the panel will tell them when they next look.
      skipped.push(row.id);
      continue;
    }

    const notice: Notice = {
      id: row.id,
      ref: ticket.ref,
      title: ticket.title,
      kind: ticket.kind,
      toStatus: row.to_status,
      note: row.note,
    };

    const sent = await postToSpace(space, phrase(notice));
    if (sent.ok) delivered.push(row.id);
    else failed.push(`${row.id}: ${sent.reason}`);
  }

  /*
   * Marked only for the ones that actually landed.
   *
   * An update marked delivered because we tried is an update nobody ever gets:
   * the panel will not show it again either. Anything that failed stays
   * pending, and the next run -- or the next time they open Gaib -- picks it up.
   */
  if (delivered.length) {
    await db
      .from("gaib_ticket_notices")
      .update({ delivered_at: new Date().toISOString() })
      .in("id", delivered);
  }

  return NextResponse.json({
    considered: rows.length,
    delivered: delivered.length,
    waitingOnSomebodyToSayHelloFirst: skipped.length,
    ticketMissing: orphaned.length,
    failed,
  });
}
