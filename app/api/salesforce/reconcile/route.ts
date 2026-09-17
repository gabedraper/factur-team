import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { reconcileSalesforce } from "@/lib/salesforce/reconcile";

/*
 * Hourly: count Salesforce against the mirror and the app, and learn what
 * Salesforce deleted. Same secret as the sync. See lib/salesforce/reconcile.ts.
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

  try {
    const result = await reconcileSalesforce();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
