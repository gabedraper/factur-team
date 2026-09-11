import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { pushEdits, requeueStuck } from "@/lib/salesforce/writeback";

/*
 * The sweep behind the write-back.
 *
 * A save pushes its own edit in the same request, so this is not the normal
 * path -- it is the safety net for the ones that did not make it: a Salesforce
 * hiccup, a deploy mid-request, a serverless instance that went away before
 * after() finished. It also puts rows a crash left mid-flight back in the
 * queue; pushing the same values twice costs one extra write and nothing else.
 *
 * Same secret as the inbound sync, so one value governs both directions.
 */

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();
  const { data: secretRow } = await db
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) return new NextResponse("Unauthorized", { status: 401 });

  const { data: settings } = await db
    .from("salesforce_writeback_settings").select("enabled").eq("id", true).maybeSingle();
  if (!(settings as { enabled: boolean } | null)?.enabled) {
    return NextResponse.json({ skipped: true, why: "write-back is switched off" });
  }

  try {
    const requeued = await requeueStuck();
    const tally = await pushEdits({ limit: 100 });
    return NextResponse.json({ ok: true, requeued, ...tally });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
