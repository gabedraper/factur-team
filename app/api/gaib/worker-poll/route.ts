import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sweep } from "@/lib/gaib/worker/engine";

/*
 * Answers that finished after the request that asked had gone.
 *
 * A task on Managed Agents can run for an hour; the Chat webhook that started
 * it waits a few minutes at most. pg_cron calls this every minute, and any
 * turn that has finished since gets posted -- once, however many callers find
 * it -- and workers quiet for half a day are wound up.
 */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });
  const { data: secretRow } = await createServiceClient()
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) return new NextResponse("Unauthorized", { status: 401 });

  return NextResponse.json(await sweep());
}
