import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { GAIB_MODEL, GAIB_SYSTEM, GAIB_TOOLS } from "./prompt";
import { createTicket, searchTickets, type Lane, type Severity, type TicketKind } from "./tickets";

/*
 * One turn of a conversation with Gaib.
 *
 * A manual loop rather than the SDK's tool runner, for one reason: every step
 * of the turn has to be written to the database as it happens, including the
 * tool calls. A conversation that is replayed on the next turn without its tool
 * calls has no memory of having already raised a ticket, and will cheerfully
 * raise it again. Persistence is the whole point of the loop, so the loop is
 * ours.
 */

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "working"; what: string }
  | { type: "ticket"; ref: number; title: string; lane: Lane }
  | { type: "error"; message: string }
  | { type: "done" };

/** How many times Gaib may call a tool before we stop it. */
const MAX_STEPS = 6;

type Row = { role: "user" | "assistant"; content: string; blocks: unknown };

async function history(sessionId: string): Promise<Anthropic.MessageParam[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("gaib_messages")
    .select("role,content,blocks")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  return ((data ?? []) as Row[]).map((m) => ({
    role: m.role,
    // Blocks win when present -- they carry the tool calls that plain text
    // cannot. Text is the fallback for ordinary typed messages.
    content: (m.blocks as Anthropic.ContentBlockParam[] | null) ?? m.content,
  }));
}

async function save(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  blocks: unknown | null,
  pageUrl: string | null = null
) {
  const db = createServiceClient();
  await db.from("gaib_messages").insert({
    session_id: sessionId, role, content, blocks, page_url: pageUrl,
  });
  await db
    .from("gaib_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", sessionId);
}

/** The readable text of an assistant turn, for the transcript and for lists. */
function textOf(blocks: Anthropic.ContentBlock[]): string {
  return blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

export type TurnInput = {
  sessionId: string;
  userId: string;
  /** What they typed. Null when Gaib is opening the conversation itself. */
  message: string | null;
  pageUrl: string | null;
  person: { name: string; role: string | null };
};

export async function* runTurn(input: TurnInput): AsyncGenerator<ChatEvent> {
  const client = new Anthropic();
  const messages = await history(input.sessionId);

  if (input.message) {
    await save(input.sessionId, "user", input.message, null, input.pageUrl);
    messages.push({ role: "user", content: input.message });
  }

  /*
   * Who and where, kept out of the system prompt on purpose.
   *
   * These change on every request. In the system prompt they would move the
   * cache breakpoint for every user and every page, and the standing
   * instructions above them would never be cached at all.
   */
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: GAIB_SYSTEM, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: [
        `You are speaking with ${input.person.name}${input.person.role ? `, ${input.person.role}` : ""}.`,
        input.pageUrl ? `They are on ${input.pageUrl}.` : "",
        `Today is ${new Date().toISOString().slice(0, 10)}.`,
      ].filter(Boolean).join(" "),
    },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    let message: Anthropic.Message;

    try {
      const stream = client.messages.stream({
        model: GAIB_MODEL,
        max_tokens: 16000,
        // Medium rather than high: someone is sitting watching this render, and
        // the one judgement that could justify the extra thinking -- which lane
        // a fix belongs in -- is re-decided from the real diff later anyway.
        output_config: { effort: "medium" },
        system,
        tools: GAIB_TOOLS,
        messages,
      });

      // Iterating the stream rather than using stream.on("text") because the
      // deltas have to leave this function as they arrive, and a callback
      // cannot yield out of the generator it was registered inside.
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      message = await stream.finalMessage();
    } catch (e) {
      const why = e instanceof Anthropic.APIError
        ? `${e.status ?? ""} ${e.message}`.trim()
        : e instanceof Error ? e.message : "unknown error";
      yield { type: "error", message: why };
      return;
    }

    messages.push({ role: "assistant", content: message.content });
    await save(input.sessionId, "assistant", textOf(message.content), message.content);

    if (message.stop_reason !== "tool_use") break;

    const calls = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name === "search_tickets") {
        yield { type: "working", what: "checking what's already been reported" };
        const { query } = call.input as { query: string };
        const found = await searchTickets(query);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: found.length
            ? JSON.stringify(found)
            : "No live tickets matched. Nothing has been reported about this.",
        });
        continue;
      }

      if (call.name === "raise_ticket") {
        const a = call.input as {
          kind: TicketKind; title: string; body: string; severity: Severity;
          lane: Lane; lane_reason: string; page_url: string;
        };
        yield { type: "working", what: "writing it up" };
        try {
          const ticket = await createTicket({
            sessionId: input.sessionId,
            raisedBy: input.userId,
            kind: a.kind,
            title: a.title,
            body: a.body,
            severity: a.severity,
            lane: a.lane,
            laneReason: a.lane_reason,
            pageUrl: a.page_url || input.pageUrl,
          });
          yield { type: "ticket", ref: ticket.ref, title: ticket.title, lane: ticket.lane };
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Raised as Gaib ${ticket.ref} in the ${ticket.lane} lane, status ${ticket.status}. Tell them the number.`,
          });
        } catch (e) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: e instanceof Error ? e.message : "could not raise the ticket",
          });
        }
        continue;
      }

      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        is_error: true,
        content: `No such tool: ${call.name}`,
      });
    }

    messages.push({ role: "user", content: results });
    await save(input.sessionId, "user", "", results);
  }

  // Name the conversation once there is something to name it after.
  await title(input.sessionId, client);
  yield { type: "done" };
}

/**
 * A short subject line for the session list.
 *
 * Written once, from the first exchange, and never revisited -- a title that
 * changes as a conversation wanders makes the list impossible to scan back
 * through, because the entry you remember reading is no longer called that.
 */
async function title(sessionId: string, client: Anthropic) {
  const db = createServiceClient();
  const { data: session } = await db
    .from("gaib_sessions").select("title").eq("id", sessionId).maybeSingle();
  if ((session as { title: string | null } | null)?.title) return;

  const { data } = await db
    .from("gaib_messages")
    .select("role,content")
    .eq("session_id", sessionId)
    .neq("content", "")
    .order("created_at", { ascending: true })
    .limit(4);

  const transcript = ((data ?? []) as { role: string; content: string }[])
    .map((m) => `${m.role}: ${m.content}`).join("\n");
  if (transcript.length < 40) return;

  try {
    const res = await client.messages.create({
      model: GAIB_MODEL,
      max_tokens: 64,
      output_config: { effort: "low" },
      system: "Reply with a subject line of at most six words for this conversation. No quotes, no full stop.",
      messages: [{ role: "user", content: transcript }],
    });
    const line = res.content.find((b) => b.type === "text")?.text.trim().slice(0, 80);
    if (line) await db.from("gaib_sessions").update({ title: line }).eq("id", sessionId);
  } catch {
    // A conversation with no title is a small loss; a turn that failed at the
    // very end because of one is not.
  }
}
