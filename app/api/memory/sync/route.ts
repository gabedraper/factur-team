import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runSync } from "@/lib/memory/sync";

/*
 * The company memory's feeders, run by pg_cron every ten minutes.
 *
 * Behind the same secret as Gaib's other scheduled jobs. Each run works
 * through a few accounts and stops well inside the time limit; the cursors
 * in memory_sync carry the rest to the next run.
 */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });
  const { data: secretRow } = await createServiceClient()
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) return new NextResponse("Unauthorized", { status: 401 });

  return NextResponse.json(await runSync(270_000));
}
