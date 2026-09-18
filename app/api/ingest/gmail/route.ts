import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncGmailActivity } from "@/lib/ingest/gmail-activity";

/*
 * Every two minutes: read what changed in each Factur mailbox and land it as
 * activity. Called by pg_cron with the same shared secret as the Salesforce
 * sync; refuses to overlap itself through a lease, because a run that takes
 * longer than its schedule must not stack.
 *
 * The budget leaves a margin under the function's own limit for the resolver
 * pass at the end and for the mailbox that was mid-flight when time ran out.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 200_000;

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();
  const { data: secretRow } = await db.from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) return new NextResponse("Unauthorized", { status: 401 });

  const { data: claimed } = await db.rpc("claim_job_lease", { p_job: "gmail-activity", p_by: "cron", p_stale_after: "12 minutes" });
  if (!claimed) return NextResponse.json({ skipped: true, why: "a run is already in progress" });

  try {
    const only = new URL(request.url).searchParams.get("mailbox");
    const reports = await syncGmailActivity({ budgetMs: BUDGET_MS, only: only ? [only] : undefined });
    const { data: resolved } = await db.rpc("resolve_activity_events", { p_limit: 500 });
    return NextResponse.json({
      mailboxes: reports.length,
      landed: reports.reduce((a, r) => a + r.landed, 0),
      problems: reports.filter((r) => r.problem).map((r) => ({ mailbox: r.mailbox, problem: r.problem })),
      resolved,
      reports,
    });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Failed", { status: 500 });
  } finally {
    await db.rpc("release_job_lease", { p_job: "gmail-activity" });
  }
}
