import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { defaultAgent } from "@/lib/gaib/agents";
import { findMemberByEmail } from "@/lib/gaib/act-as";
import { workerFor, sendTurn, awaitTurn } from "@/lib/gaib/worker/engine";

/*
 * One turn on the Managed Agents engine, end to end, without Chat.
 *
 * For checking the engine before anyone's messages go to it: it starts (or
 * reuses) a worker, sends one message, waits for the answer and returns it
 * with every tool call made through the app. Behind the same secret as the
 * scheduled jobs, and only for people already on the engine's tester list --
 * the secret alone must not be a way to act as any member of staff.
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

  const { email, message } = (await request.json()) as { email?: string; message?: string };
  if (!email || !message) return NextResponse.json({ error: "email and message are required" }, { status: 400 });

  const agent = await defaultAgent();
  if (!agent) return NextResponse.json({ error: "no default agent" }, { status: 500 });
  const { data: settings } = await db
    .from("gaib_agents").select("worker_emails").eq("id", agent.id).single();
  const testers = ((settings as { worker_emails: string[] } | null)?.worker_emails ?? []).map((e) => e.toLowerCase());
  if (!testers.includes(email.toLowerCase())) {
    return NextResponse.json({ error: "not on the worker tester list" }, { status: 403 });
  }

  const person = await findMemberByEmail(email);
  if (!person) return NextResponse.json({ error: "no account for that email" }, { status: 404 });

  const { data: existing } = await db
    .from("gaib_sessions").select("id")
    .eq("user_id", person.userId).eq("channel_ref", "worker-test").eq("status", "open")
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  let sessionId = (existing as { id: string } | null)?.id;
  if (!sessionId) {
    const { data: created, error } = await db.from("gaib_sessions").insert({
      user_id: person.userId, agent_id: agent.id, opened_by: "user", channel: "app", channel_ref: "worker-test",
    }).select("id").single();
    if (error || !created) return NextResponse.json({ error: `session: ${error?.message}` }, { status: 500 });
    sessionId = (created as { id: string }).id;
  }

  const started = Date.now();
  try {
    const worker = await workerFor({
      agent, gaibSessionId: sessionId, userId: person.userId, email,
      name: person.fullName ?? email, mode: "private", replySpace: null, replyThread: null,
    });
    await sendTurn(worker, { name: person.fullName ?? email, text: message, channel: "app" });
    const result = await awaitTurn(worker, started + 270_000);

    const { data: actions } = await db
      .from("gaib_worker_actions").select("tool,ok,result_preview,created_at")
      .eq("worker_id", worker.id).gte("created_at", new Date(started).toISOString())
      .order("created_at");

    return NextResponse.json({
      worker: worker.id,
      managedSession: worker.managed_session_id,
      seconds: Math.round((Date.now() - started) / 1000),
      done: result.done,
      text: result.text ?? null,
      actions,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
