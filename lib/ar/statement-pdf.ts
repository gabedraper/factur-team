import { readFile } from "fs/promises";
import { join } from "path";
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

/** Why a statement could not be drawn, in words a person can act on. */
export type StatementProblem = { problem: string };

/*
 * Read once. The wordmark is 2KB and never changes between deploys, so
 * re-reading it per statement is work for nothing -- and a statement drawn
 * inside a send should not be waiting on the filesystem.
 */
let logoCache: Buffer | null | undefined;

async function logo(): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = await readFile(join(process.cwd(), "public", "factur-logo.png"));
  } catch {
    // Rendering the name in type is a worse statement, not a broken one.
    logoCache = null;
  }
  return logoCache;
}

/**
 * Draw a client's statement, or say why not.
 *
 * Reconciled against QuickBooks' own A/R ageing figure before it is drawn at
 * all. A statement that disagrees with QuickBooks is worse than no statement:
 * the client checks it against their ledger, finds it wrong, and every later
 * thing we say about the balance is worth less. Where the two disagree the
 * cause is almost always a credit memo -- a QuickBooks entity Coupler is not
 * pulling -- so the difference is named rather than papered over.
 *
 * Callers must check permissions first: this uses the service connection so it
 * can be built inside a send, where there is no browser session to speak of.
 */
export async function buildStatement(
  clientId: string
): Promise<Statement | StatementProblem | null> {
  const db = createServiceClient();

  const [{ data: client }, { data: rows }, { data: qbTotal }] = await Promise.all([
    db.from("org_clients").select("name").eq("id", clientId).maybeSingle(),
    db.rpc("get_client_statement", { p_client_id: clientId }),
    db.rpc("get_client_ar_total", { p_client_id: clientId }),
  ]);

  const name = (client as { name: string } | null)?.name;
  if (!name) return null;

  const lines = (rows ?? []) as StatementLine[];
  if (lines.length === 0) return null;

  const total = lines.reduce((t, l) => t + Number(l.balance), 0);

  /*
   * Null means QuickBooks does not have this client on its ageing report at
   * all, which is not a disagreement -- it is a client whose invoices are all
   * dated in the future. Nothing to reconcile against, so we go ahead.
   */
  const quickbooks = qbTotal === null ? null : Number(qbTotal);
  if (quickbooks !== null && Math.abs(total - quickbooks) > 0.01) {
    const gap = new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD",
    }).format(Math.abs(total - quickbooks));
    return {
      problem:
        `Statement does not agree with QuickBooks for ${name}: we make it ` +
        `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)}, ` +
        `QuickBooks says ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(quickbooks)}, ` +
        `a difference of ${gap}. Usually a credit memo, which we do not sync yet.`,
    };
  }

  const element = createElement(StatementDocument, {
    clientName: name,
    lines,
    asAt: new Date().toISOString().slice(0, 10),
    // Links are per invoice, so the oldest open one's is used: it is the one we
    // most want paid, and the lines arrive oldest first.
    payLink: lines.find((l) => l.kind === "invoice" && l.pay_link)?.pay_link ?? null,
    logo: await logo(),
  });

  const stream = await renderToStream(element as Parameters<typeof renderToStream>[0]);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }

  return {
    clientName: name,
    lines,
    total,
    pdf: Buffer.concat(chunks),
    filename: `Statement — ${name.replace(/[^\w\s-]/g, "").trim() || "account"}.pdf`,
  };
}
