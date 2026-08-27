import { NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runTurn, type ChatEvent } from "@/lib/gaib/chat";

/*
 * The chat endpoint.
 *
 * Newline-delimited JSON rather than server-sent events. The client is a fetch
 * in a dialog, not an EventSource, and NDJSON means the same objects the
 * generator already yields go down the wire untouched -- no framing to get
 * wrong at either end, and a stalled stream shows up as a partial line rather
 * than as silence.
 */

export const maxDuration = 60;

type Body = {
  sessionId?: string;
  message?: string;
  pageUrl?: string;
  /** Set when the app opened the conversation rather than the person. */
  openedBy?: "user" | "gaib";
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const body = (await request.json()) as Body;
  const db = createServiceClient();

  // An existing session is only usable by the person it belongs to. Without
  // this check a guessed id would read somebody else's conversation straight
  // back out of the history the next turn loads.
  let sessionId = body.sessionId ?? null;
  if (sessionId) {
    const { data } = await db
      .from("gaib_sessions").select("id").eq("id", sessionId).eq("user_id", user.id).maybeSingle();
    if (!data) sessionId = null;
  }

  if (!sessionId) {
    const { data, error } = await db
      .from("gaib_sessions")
      .insert({ user_id: user.id, opened_by: body.openedBy ?? "user" })
      .select("id")
      .single();
    if (error || !data) return new Response("Could not start a conversation", { status: 500 });
    sessionId = (data as { id: string }).id;
  }

  const { data: profile } = await db
    .from("profiles").select("full_name,role").eq("id", user.id).maybeSingle();
  const p = profile as { full_name: string | null; role: string | null } | null;

  const turn = runTurn({
    sessionId,
    userId: user.id,
    message: body.message?.trim() || null,
    pageUrl: body.pageUrl ?? null,
    person: { name: p?.full_name || user.email || "a colleague", role: p?.role ?? null },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ChatEvent | { type: "session"; id: string }) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      send({ type: "session", id: sessionId });
      try {
        for await (const event of turn) send(event);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Vercel's proxy will otherwise sit on a short stream until it finishes,
      // which turns a live reply into a long pause followed by everything.
      "X-Accel-Buffering": "no",
    },
  });
}
