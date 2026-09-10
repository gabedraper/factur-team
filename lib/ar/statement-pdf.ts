import { renderToStream } from "@react-pdf/renderer";
import { createElement } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { StatementDocument, type StatementLine } from "@/lib/ar/statement";

export type Statement = {
  clientName: string;
  lines: StatementLine[];
  total: number;
  pdf: Buffer;
  filename: string;
};

/**
 * Draw a client's statement.
 *
 * Callers must check permissions first: this uses the service connection so it
 * can be built inside a send, where there is no browser session to speak of.
 * Every route and action that reaches it gates on finance or org.manage.
 */
export async function buildStatement(clientId: string): Promise<Statement | null> {
  const db = createServiceClient();

  const [{ data: client }, { data: rows }] = await Promise.all([
    db.from("org_clients").select("name").eq("id", clientId).maybeSingle(),
    db.rpc("get_client_statement", { p_client_id: clientId }),
  ]);

  const name = (client as { name: string } | null)?.name;
  if (!name) return null;

  const lines = (rows ?? []) as StatementLine[];
  if (lines.length === 0) return null;

  /*
   * One pay link for the whole statement is not a thing QuickBooks gives us --
   * links are per invoice -- so the oldest open invoice's is used. It is the
   * one we most want paid, and the lines arrive oldest first.
   */
  const element = createElement(StatementDocument, {
    clientName: name,
    lines,
    asAt: new Date().toISOString().slice(0, 10),
    payLink: lines.find((l) => l.pay_link)?.pay_link ?? null,
  });

  const stream = await renderToStream(element as Parameters<typeof renderToStream>[0]);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }

  return {
    clientName: name,
    lines,
    total: lines.reduce((t, l) => t + l.balance, 0),
    pdf: Buffer.concat(chunks),
    filename: `Statement — ${name.replace(/[^\w\s-]/g, "").trim() || "account"}.pdf`,
  };
}
