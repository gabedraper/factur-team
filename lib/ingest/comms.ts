import { createServiceClient } from "@/lib/supabase/server";
import { fetchBillingMail } from "@/lib/google/gmail";
import { fetchChat } from "@/lib/google/chat";
import { fetchTranscripts } from "@/lib/google/drive";
import { lookUpPeople } from "@/lib/google/people";

const OUR_DOMAINS = new Set(["facturmfg.com", "bethefactur.com"]);

export type IngestReport = {
  account: string;
  kind: "mail" | "chat" | "meetings";
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
        kind: "mail",
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
      account, kind: "mail", matching: 0, found: 0, attached: 0,
      byDomain: 0, byThread: 0, byName: 0,
      hitCap: false,
      problem: e instanceof Error ? e.message : "Unknown error",
    };
  }
}


/*
 * Words that make a line about getting paid.
 *
 * Mail is narrowed by its subject line, which neither chat nor a transcript
 * has -- a chat message is one line and a transcript is an hour of talk. So
 * they are narrowed by what is said instead, in plain words, because the
 * internal chatter this is for sounds like "did they ever pay the June one".
 *
 * Deliberately missing: "check", "wire", "balance" and "statement". Every one
 * of them is ordinary speech in this business -- the client calls are named
 * "Check-In", the parts have wire in them, and a statement of work is not a
 * statement of account. "check" alone matched all twelve meeting transcripts
 * on their own titles. Where those words do belong they are kept in a phrase.
 */
const MONEY_TALK = new RegExp(
  [
    "\\b(invoic\\w*|payment|payments|paid|pay|paying|pays|owes?|owed|owing",
    "|remit\\w*|receivable|receivables|collections?|billing|billed|unpaid",
    "|past[- ]due|overdue|credit hold|net ?(30|45|60))\\b",
    "|\\b(outstanding|unpaid|overdue|open)\\s+(balance|amount|invoice|item)",
    "|\\bbalance\\s+(due|owing|outstanding)\\b",
    "|\\b(paid|pay|send|sent)\\s+(by|via|a|the)\\s+(check|cheque|wire|ach)\\b",
  ].join(""),
  "i"
);

function mentions(text: string): boolean {
  return MONEY_TALK.test(text);
}

/**
 * Where the talking starts in a transcript.
 *
 * The document opens with its own title, then "Attendees" and a list of names,
 * then "Transcript" and the speaker lines. Everything before that last word is
 * about the meeting rather than in it.
 */
function bodyStart(text: string): number {
  const at = text.search(/\bTranscript\b\s*\n/);
  return at === -1 ? 0 : at;
}

/** Client lookups, built once and shared by the chat and meeting ingests. */
async function clientIndex(db: ReturnType<typeof createServiceClient>) {
  const [{ data: domains }, { data: names }] = await Promise.all([
    db.rpc("get_client_domains"),
    db.rpc("get_client_name_patterns"),
  ]);

  const byDomain = new Map<string, string>();
  for (const d of (domains ?? []) as { client_id: string; domain: string }[]) {
    byDomain.set(d.domain, d.client_id);
  }

  // Longest first, so "Geospace 2" is tried before "Geospace".
  const patterns = ((names ?? []) as { client_id: string; client_name: string }[])
    .map((n) => ({ clientId: n.client_id, key: normalise(n.client_name) }))
    .filter((n) => n.key.length >= 6)
    .sort((a, b) => b.key.length - a.key.length);

  return { byDomain, patterns };
}

function empty(account: string, kind: IngestReport["kind"], problem: string | null): IngestReport {
  return {
    account, kind, matching: 0, found: 0, attached: 0,
    byDomain: 0, byThread: 0, byName: 0, hitCap: false, problem,
  };
}

/**
 * Internal Google Chat about getting paid.
 *
 * This is the conversation that never reaches the client: finance, the team
 * lead and the account manager working out what to do about an unpaid invoice.
 * There is no client on the thread and no subject line, so a message can only
 * be attached by naming the client -- either in what was said, or in the name
 * of the space it was said in.
 *
 * Only the first hundred and sixty characters are kept, the same as mail. The
 * full line is fetched from Google when someone opens it.
 */
export async function ingestChatFor(account: string, sinceDays = 90): Promise<IngestReport> {
  const db = createServiceClient();

  try {
    const { byDomain, patterns } = await clientIndex(db);
    const { messages } = await fetchChat(account, sinceDays);

    /*
     * Who said it.
     *
     * Chat leaves the display name empty on many messages and gives only
     * `users/<id>`. Ids already looked up are read from the table rather than
     * asked about again -- the same twenty colleagues appear in every sweep.
     */
    const senders = [...new Set(messages.map((m) => m.author).filter(Boolean) as string[])]
      .filter((a) => /^users\/\d+$/.test(a))
      .map((a) => a.split("/")[1]);

    const { data: known } = await db
      .from("google_people")
      .select("google_id,display_name,email")
      .in("google_id", senders.length ? senders : ["none"]);

    const nameById = new Map(
      ((known ?? []) as { google_id: string; display_name: string | null; email: string | null }[])
        .map((k) => [k.google_id, k])
    );

    let nameProblem: string | null = null;
    const missing = senders.filter((id) => !nameById.has(id));
    if (missing.length) {
      const { people, problem } = await lookUpPeople(missing, account);
      /*
       * A failed lookup costs names, not messages, so the sweep carries on --
       * but it is reported. Silently resolving nothing looks identical to
       * there being nobody to resolve, which cost a whole sweep to notice.
       */
      if (problem && people.length === 0) {
        nameProblem = `Names not resolved — ${problem}`;
      }
      if (people.length) {
        await db.from("google_people").upsert(
          people.map((p) => ({
            google_id: p.googleId,
            email: p.email,
            display_name: p.name,
            resolved_at: new Date().toISOString(),
          })),
          { onConflict: "google_id" }
        );
        for (const p of people) {
          nameById.set(p.googleId, {
            google_id: p.googleId, display_name: p.name, email: p.email,
          });
        }
      }
    }

    const counts = { domain: 0, name: 0 };

    const rows = messages
      .map((m) => {
        if (!mentions(m.text)) return null;

        const said = normalise(m.text);
        const space = normalise(m.spaceLabel ?? "");

        // The space name first: a space called "Mako - collections" is about
        // Mako even on a line that only says "still nothing".
        let clientId = patterns.find((n) => space.includes(n.key))?.clientId ?? null;
        let matchedBy: "domain" | "name" | null = clientId ? "domain" : null;

        if (!clientId) {
          clientId = patterns.find((n) => said.includes(n.key))?.clientId ?? null;
          matchedBy = clientId ? "name" : null;
        }
        if (!clientId || !matchedBy) return null;
        counts[matchedBy]++;

        // A raw id is never shown; either the directory knows them or nobody is
        // named on the line.
        const isId = m.author ? /^users\/\d+$/.test(m.author) : false;
        const who = isId ? nameById.get(m.author!.split("/")[1]) : undefined;
        const plainName = !isId ? m.author : null;

        return {
          source: "google_chat",
          // Chat ids are already domain-wide, so the same message reached from
          // two people's space lists stores once.
          external_id: m.id,
          gmail_id: null,
          ingested_from: account,
          thread_id: m.spaceName,
          client_id: clientId,
          matched_by: matchedBy,
          occurred_at: m.createdAt.toISOString(),
          // Nobody outside the company is in these spaces.
          direction: "internal",
          author_email: who?.email ?? null,
          author_name: who?.display_name ?? plainName,
          participants: [],
          subject: m.spaceLabel ?? "Chat",
          extract: m.text.slice(0, 160),
          topics: ["billing"],
          url: `https://mail.google.com/chat/u/0/#chat/space/${
            m.spaceName.split("/").pop() ?? ""
          }`,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length) {
      const { error } = await db
        .from("comm_messages")
        .upsert(rows, { onConflict: "source,external_id" });
      if (error) throw new Error(error.message);
    }

    return {
      account, kind: "chat",
      matching: messages.length,
      found: messages.length,
      attached: rows.length,
      byDomain: counts.domain, byThread: 0, byName: counts.name,
      hitCap: false, problem: nameProblem,
    };
  } catch (e) {
    return empty(account, "chat", e instanceof Error ? e.message : "Unknown error");
  }
}

/**
 * Meeting transcripts where money came up.
 *
 * Google files a recorded meeting's transcript in the organiser's Drive, so
 * these arrive as documents rather than messages. The client is read off the
 * attendee list, which is the strongest signal any of the three sources has --
 * an email address on the invitation, not a name in a subject line.
 *
 * A whole meeting is rarely about an invoice, so what is kept is the part that
 * was: the passage around the first time payment is mentioned. Opening the
 * message fetches the full transcript from Drive.
 */
export async function ingestTranscriptsFor(
  account: string,
  sinceDays = 90
): Promise<IngestReport> {
  const db = createServiceClient();

  try {
    const { byDomain, patterns } = await clientIndex(db);
    const { transcripts, matching, hitCap } = await fetchTranscripts(account, sinceDays);

    const counts = { domain: 0, name: 0 };

    const rows = transcripts
      .map((t) => {
        /*
         * Google puts a title and an attendee list above the talk, and the
         * title is where the client's name lives -- so searching the whole
         * document finds the header every time and the extract is a header
         * rather than the moment money came up. Only what was said is searched.
         */
        const spoken = t.text.slice(bodyStart(t.text));
        const hit = MONEY_TALK.exec(spoken);
        if (!hit) return null;

        const outside = t.attendees.filter((a) => !OUR_DOMAINS.has(domainOf(a)));
        let clientId = outside.map((a) => byDomain.get(domainOf(a))).find(Boolean) ?? null;
        let matchedBy: "domain" | "name" | null = clientId ? "domain" : null;

        // A meeting with no outside attendee is an internal one; the title has
        // to say who it was about.
        if (!clientId) {
          const title = normalise(t.title);
          clientId = patterns.find((n) => title.includes(n.key))?.clientId ?? null;
          matchedBy = clientId ? "name" : null;
        }
        if (!clientId || !matchedBy) return null;
        counts[matchedBy]++;

        // The sentence where it came up, with a little either side of it.
        const at = hit.index ?? 0;
        const extract = spoken
          .slice(Math.max(0, at - 60), at + 200)
          .replace(/\s+/g, " ")
          .trim();

        return {
          source: "meet_transcript",
          external_id: t.id,
          gmail_id: null,
          ingested_from: account,
          thread_id: null,
          client_id: clientId,
          matched_by: matchedBy,
          occurred_at: t.createdAt.toISOString(),
          direction: outside.length === 0 ? "internal" : "outbound",
          author_email: null,
          author_name: null,
          participants: t.attendees,
          subject: t.title,
          extract: extract ? `…${extract}…` : null,
          topics: ["billing"],
          url: t.url,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length) {
      const { error } = await db
        .from("comm_messages")
        .upsert(rows, { onConflict: "source,external_id" });
      if (error) throw new Error(error.message);
    }

    return {
      account, kind: "meetings",
      matching,
      found: transcripts.length,
      attached: rows.length,
      byDomain: counts.domain, byThread: 0, byName: counts.name,
      hitCap, problem: null,
    };
  } catch (e) {
    return empty(account, "meetings", e instanceof Error ? e.message : "Unknown error");
  }
}
