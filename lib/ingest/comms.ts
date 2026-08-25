import { createServiceClient } from "@/lib/supabase/server";
import { fetchBillingMail } from "@/lib/google/gmail";

const OUR_DOMAINS = new Set(["facturmfg.com", "bethefactur.com"]);

export type IngestReport = {
  account: string;
  /** Everything matching the search, whether or not it was fetched. */
  matching: number;
  found: number;
  attached: number;
  byDomain: number;
  byThread: number;
  byName: number;
  hitCap: boolean;
  problem: string | null;
};

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Reduce text to lowercase words for comparison.
 *
 * Both sides are normalised rather than matched with a word-boundary pattern,
 * because a name ending in punctuation defeats one: `\b` needs a word character
 * beside it, and there is none after the full stop in "Marks Machine Co., Inc."
 * Sixty-six client names carry a suffix like that, so the pattern approach
 * silently matched none of them.
 */
function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
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
export async function ingestBillingMailFor(
  account: string,
  sinceDays = 90
): Promise<IngestReport> {
  const db = createServiceClient();

  const [{ data: domains }, { data: names }] = await Promise.all([
    db.rpc("get_client_domains"),
    db.rpc("get_client_name_patterns"),
  ]);

  // domain -> client, built once rather than per message.
  const clientByDomain = new Map<string, string>();
  for (const d of (domains ?? []) as { client_id: string; domain: string }[]) {
    clientByDomain.set(d.domain, d.client_id);
  }

  /*
   * Client names as word-boundary patterns, longest first.
   *
   * Longest first because "Geospace 2" must be tried before "Geospace", or
   * every message about the second lands on the first.
   */
  const namePatterns = ((names ?? []) as { client_id: string; client_name: string }[])
    .map((n) => ({ clientId: n.client_id, name: n.client_name, key: normalise(n.client_name) }))
    .filter((n) => n.key.length >= 6)
    .sort((a, b) => b.key.length - a.key.length);

  /*
   * Threads already known to belong to a client, from previous runs. This is
   * what lets an internal reply attach: the client's own message came in on
   * the same thread, possibly weeks earlier.
   */
  const { data: knownThreads } = await db
    .from("comm_messages")
    .select("thread_id,client_id")
    .not("thread_id", "is", null)
    .not("client_id", "is", null);

  const clientByThread = new Map<string, string>();
  for (const t of (knownThreads ?? []) as { thread_id: string; client_id: string }[]) {
    clientByThread.set(t.thread_id, t.client_id);
  }

  try {
    {
      const { messages, matching, hitCap } = await fetchBillingMail(account, sinceDays);

      /*
       * First pass: anything with a recognisable client domain. Done for the
       * whole batch before anything else, so a thread's client is known before
       * the internal replies on it are considered -- they often arrive in the
       * same fetch, and in whatever order Gmail returned them.
       */
      for (const m of messages) {
        const outside = m.participants.filter((p) => !OUR_DOMAINS.has(domainOf(p)));
        const viaDomain = outside.map((p) => clientByDomain.get(domainOf(p))).find(Boolean);
        if (viaDomain) clientByThread.set(m.threadId, viaDomain);
      }

      const counts = { domain: 0, thread: 0, name: 0 };

      const rows = messages
        .map((m) => {
          const outside = m.participants.filter((p) => !OUR_DOMAINS.has(domainOf(p)));
          const viaDomain = outside.map((p) => clientByDomain.get(domainOf(p))).find(Boolean);

          let clientId: string | null = viaDomain ?? null;
          let matchedBy: "domain" | "thread" | "name" | null = viaDomain ? "domain" : null;

          // Second: an internal message on a thread the client is already on.
          if (!clientId) {
            const viaThread = clientByThread.get(m.threadId);
            if (viaThread) {
              clientId = viaThread;
              matchedBy = "thread";
            }
          }

          // Third: a fresh internal thread that names the client in its subject.
          // The weakest of the three, so it is tried last and recorded as such.
          if (!clientId && m.subject) {
            const subject = normalise(m.subject);
            // Padded with spaces on both sides, so this is a whole-word match:
            // "Arku" does not match inside "Arkusiewicz".
            const hit = namePatterns.find((n) => subject.includes(n.key));
            if (hit) {
              clientId = hit.clientId;
              matchedBy = "name";
            }
          }

          if (!clientId || !matchedBy) return null;
          counts[matchedBy]++;

          const fromUs = m.from ? OUR_DOMAINS.has(domainOf(m.from)) : false;
          return {
            source: "gmail",
            // The sender's own id where there is one, so the same message
            // arriving in four mailboxes is stored once.
            external_id: m.rfcId ?? m.id,
            gmail_id: m.id,
            // Which mailbox this copy came from. A Gmail id only resolves in
            // the mailbox it belongs to, so reading the body later has to ask
            // the same person.
            ingested_from: account,
            thread_id: m.threadId,
            client_id: clientId,
            matched_by: matchedBy,
            occurred_at: m.occurredAt.toISOString(),
            direction: outside.length === 0 ? "internal" : fromUs ? "outbound" : "inbound",
            author_email: m.from,
            author_name: null,
            participants: m.participants,
            subject: m.subject,
            extract: m.snippet,
            topics: ["billing"],
            // Searched by the sender's Message-ID rather than linked by thread
            // id, which is per-mailbox and 404s for anyone else.
            url: m.rfcId
              ? `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(
                  m.rfcId.replace(/[<>]/g, "")
                )}`
              : null,
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

      return {
        account,
        matching,
        found: messages.length,
        attached: rows.length,
        byDomain: counts.domain,
        byThread: counts.thread,
        byName: counts.name,
        hitCap,
        problem: null,
      };
    }
  } catch (e) {
    return {
      account, matching: 0, found: 0, attached: 0,
      byDomain: 0, byThread: 0, byName: 0,
      hitCap: false,
      problem: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
