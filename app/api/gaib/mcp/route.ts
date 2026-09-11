import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { actAs } from "@/lib/gaib/act-as";
import { defaultAgent } from "@/lib/gaib/agents";
import { toolsFor, type ToolContext } from "@/lib/gaib/tools";
import { GROUP_SAFE_TOOLS } from "@/lib/gaib/chat";
import { hashToken, type Worker } from "@/lib/gaib/worker/engine";

/*
 * Gaib's tools, served to Gaib running on Managed Agents.
 *
 * The same tools the chat engine uses, over MCP -- a JSON-RPC exchange over
 * POST (the "streamable HTTP" transport, answered with plain JSON; nothing
 * here needs to stream). Only the four methods an agent actually calls are
 * implemented: initialize, the initialized notification, tools/list and
 * tools/call.
 *
 * The bearer token is the whole identity. It was minted for one Managed Agents
 * session and stored in that session's vault; here it is hashed and looked up,
 * and the worker row says whose session it is and whether it is a room. Each
 * call then runs through actAs, so the database answers with that person's
 * row-level security and Google calls go out as them. Nothing in a request can
 * name a different person.
 */

export const maxDuration = 300;

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}
function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

async function workerForToken(request: NextRequest): Promise<Worker | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data } = await createServiceClient()
    .from("gaib_workers").select("*")
    .eq("token_hash", hashToken(token))
    .in("status", ["starting", "running", "idle"])
    .maybeSingle();
  return (data as Worker | null) ?? null;
}

async function toolsForWorker(worker: Worker) {
  const agent = await defaultAgent();
  if (!agent) return [];
  const tools = toolsFor(agent.tools);
  // A room reads the answer, so only what everyone in it could already see.
  return worker.mode === "room" ? tools.filter((t) => GROUP_SAFE_TOOLS.has(t.name)) : tools;
}

async function handle(worker: Worker, msg: RpcRequest): Promise<object | null> {
  // Notifications carry no id and get no answer.
  if (msg.id === undefined) return null;

  switch (msg.method) {
    case "initialize":
      return rpcResult(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "factur", version: "1.0.0" },
        instructions:
          "Factur's own data and actions. Every tool acts as the person Gaib is talking to, with their permissions.",
      });

    case "ping":
      return rpcResult(msg.id, {});

    case "tools/list": {
      const tools = await toolsForWorker(worker);
      return rpcResult(msg.id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.definition.description ?? t.blurb,
          inputSchema: t.definition.input_schema,
        })),
      });
    }

    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const input = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = (await toolsForWorker(worker)).find((t) => t.name === name);
      if (!tool) {
        return rpcResult(msg.id, {
          content: [{ type: "text", text: `No tool called ${name} is available here.` }],
          isError: true,
        });
      }

      const acting = await actAs(worker.email);
      if (!acting.ok) {
        return rpcResult(msg.id, {
          content: [{ type: "text", text: `Could not act as ${worker.email} (${acting.reason}).` }],
          isError: true,
        });
      }

      const db = createServiceClient();
      const ctx: ToolContext = {
        userId: worker.user_id,
        email: acting.session.email,
        db: acting.session.db,
        sessionId: worker.gaib_session_id,
        pageUrl: null,
        publicOnly: worker.mode === "room",
        gifs: [],
      };

      let text: string;
      let ok = true;
      try {
        text = await tool.run(ctx, input);
      } catch (e) {
        ok = false;
        text = `That didn't work: ${e instanceof Error ? e.message : "unknown error"}`;
      } finally {
        await acting.session.release();
      }

      await db.from("gaib_worker_actions").insert({
        worker_id: worker.id,
        user_id: worker.user_id,
        tool: name,
        input,
        ok,
        result_preview: text.slice(0, 500),
      });
      await db.from("gaib_workers")
        .update({ last_activity_at: new Date().toISOString() }).eq("id", worker.id);

      // A GIF picked during the task is posted after the answer, like the chat engine does.
      if (ctx.gifs?.length) {
        await db.from("gaib_workers")
          .update({ gifs: [...(worker.gifs ?? []), ...ctx.gifs] }).eq("id", worker.id);
      }

      return rpcResult(msg.id, { content: [{ type: "text", text }], isError: !ok });
    }

    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(request: NextRequest) {
  const worker = await workerForToken(request);
  if (!worker) return new NextResponse("Unauthorized", { status: 401 });

  let body: RpcRequest | RpcRequest[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(worker, m)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }

  const out = await handle(worker, body);
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
}

// No server-initiated stream: every answer comes back on the POST that asked.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
