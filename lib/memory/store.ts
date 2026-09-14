import { createServiceClient } from "@/lib/supabase/server";

/*
 * Writing into the company memory.
 *
 * A passage is one searchable piece: a chunk of a document, one chat message,
 * one note. The same passage can be found through several people -- a doc
 * shared with ten of them is fetched ten times -- and each time it is seen the
 * person it was seen as is added to its audience rather than a copy being
 * made. That union is the permission model: you may read what you could
 * already have opened yourself.
 */

export type Passage = {
  source: string;
  sourceId: string;
  chunk?: number;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  body: string;
  /** Staff addresses, or ["*"] for the whole company. */
  audience: string[];
  occurredAt?: string | null;
};

/** About a screen of text. Long enough to carry a point, short enough to rank. */
const CHUNK_CHARS = 1500;

/** Cut a document on paragraph breaks into pieces of roughly CHUNK_CHARS. */
export function chunk(text: string): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];

  const out: string[] = [];
  let buffer = "";
  for (const para of clean.split(/\n\n+/)) {
    if (buffer && buffer.length + para.length + 2 > CHUNK_CHARS) {
      out.push(buffer);
      buffer = "";
    }
    // A single paragraph longer than a chunk is split on sentences.
    if (para.length > CHUNK_CHARS) {
      for (const sentence of para.split(/(?<=[.!?])\s+/)) {
        if (buffer && buffer.length + sentence.length + 1 > CHUNK_CHARS) {
          out.push(buffer);
          buffer = "";
        }
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      }
      continue;
    }
    buffer = buffer ? `${buffer}\n\n${para}` : para;
  }
  if (buffer) out.push(buffer);
  return out;
}

/**
 * Store passages, merging audiences with anything already there.
 *
 * Done in one statement per batch through a small function rather than a
 * read-then-write, so two feeders landing the same document at once cannot
 * each overwrite the other's audience.
 */
export async function remember(passages: Passage[]): Promise<number> {
  if (passages.length === 0) return 0;
  const db = createServiceClient();
  const rows = passages.map((p) => ({
    source: p.source,
    source_id: p.sourceId,
    chunk: p.chunk ?? 0,
    title: p.title ?? null,
    url: p.url ?? null,
    author: p.author ?? null,
    body: p.body.slice(0, 8000),
    audience: [...new Set(p.audience.map((a) => a.toLowerCase()))],
    occurred_at: p.occurredAt ?? null,
  }));

  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.rpc("memory_remember", { p_rows: rows.slice(i, i + 200) });
    if (error) throw new Error(`memory: ${error.message}`);
    written += Math.min(200, rows.length - i);
  }
  return written;
}

/** Drop every chunk of a document beyond the ones just written, after a re-read shrank it. */
export async function forgetTail(source: string, sourceId: string, keepChunks: number): Promise<void> {
  await createServiceClient()
    .from("memory_passages")
    .delete()
    .eq("source", source).eq("source_id", sourceId).gte("chunk", keepChunks);
}

export type SyncState = { cursor: string | null; last_run_at: string | null; passages: number };

export async function syncState(source: string, account: string): Promise<SyncState> {
  const { data } = await createServiceClient()
    .from("memory_sync").select("cursor,last_run_at,passages")
    .eq("source", source).eq("account", account).maybeSingle();
  return (data as SyncState | null) ?? { cursor: null, last_run_at: null, passages: 0 };
}

export async function markSynced(
  source: string,
  account: string,
  patch: { cursor?: string | null; error?: string | null; passages?: number }
): Promise<void> {
  const current = await syncState(source, account);
  await createServiceClient().from("memory_sync").upsert({
    source,
    account,
    cursor: patch.cursor === undefined ? current.cursor : patch.cursor,
    last_run_at: new Date().toISOString(),
    last_error: patch.error ?? null,
    passages: current.passages + (patch.passages ?? 0),
  });
}
