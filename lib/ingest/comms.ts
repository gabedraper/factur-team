import { createServiceClient } from "@/lib/supabase/server";
import { fetchBillingMail } from "@/lib/google/gmail";

const OUR_DOMAINS = new Set(["facturmfg.com", "bethefactur.com"]);

export type IngestReport = {
  account: string;
  found: number;
  attached: number;
  hitCap: boolean;
  problem: string | null;
};

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Pull billing mail for everyone the app says should be read, and attach each
 * message to a client by the outside participant's domain.
 *
 * A message with no outside participant is internal -- two colleagues talking
 * about a client without the client on it. Those are kept when they can still
 * be attached (someone forwarding a client thread), and dropped when they
 * cannot, rather than stored against nobody.
 */
export async function ingestBillingMail(sinceDays = 90): Promise<IngestReport[]> {
  const db = createServiceClient();

  const [{ data: accounts }, { data: domains }] = await Promise.all([
    db.rpc("get_ingest_accounts"),
    db.rpc("get_client_domains"),
  ]);

  // domain -> client, built once rather than per message.
  const clientByDomain = new Map<string, string>();
  for (const d of (domains ?? []) as { client_id: string; domain: string }[]) {
    clientByDomain.set(d.domain, d.client_id);
  }

  const reports: IngestReport[] = [];

  for (const a of (accounts ?? []) as { email: string }[]) {
    try {
      const { messages, hitCap } = await fetchBillingMail(a.email, sinceDays);

      const rows = messages
        .map((m) => {
          const outside = m.participants.filter((p) => !OUR_DOMAINS.has(domainOf(p)));
          const clientId =
            outside.map((p) => clientByDomain.get(domainOf(p))).find(Boolean) ?? null;
          if (!clientId) return null;

          const fromUs = m.from ? OUR_DOMAINS.has(domainOf(m.from)) : false;
          return {
            source: "gmail",
            external_id: m.id,
            client_id: clientId,
            occurred_at: m.occurredAt.toISOString(),
            direction: outside.length === 0 ? "internal" : fromUs ? "outbound" : "inbound",
            author_email: m.from,
            author_name: null,
            participants: m.participants,
            subject: m.subject,
            extract: m.snippet,
            topics: ["billing"],
            url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length) {
        // The same thread reaches several of these mailboxes, so the same
        // message id arrives more than once across accounts. Conflicting on
        // (source, external_id) keeps one.
        const { error } = await db
          .from("comm_messages")
          .upsert(rows, { onConflict: "source,external_id" });
        if (error) throw new Error(error.message);
      }

      reports.push({
        account: a.email,
        found: messages.length,
        attached: rows.length,
        hitCap,
        problem: null,
      });
    } catch (e) {
      reports.push({
        account: a.email,
        found: 0,
        attached: 0,
        hitCap: false,
        problem: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return reports;
}
