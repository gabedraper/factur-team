import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchMail, TALENT_QUERY, type GmailMessage } from "@/lib/google/gmail";

/**
 * Pulling recruiters' mail onto candidate timelines.
 *
 * The shape is borrowed from the billing ingest, because the problem is the
 * same one: Gmail cannot be asked "which of these four thousand addresses is in
 * this mailbox", so the mail comes back broad and the matching happens here.
 * What differs is the test. Billing attaches a message to a client by domain,
 * since a company is a domain. A candidate is a person and personal addresses
 * share domains with millions of strangers, so this matches on the **exact
 * address** and nothing else. A near-miss here would file a stranger's email on
 * somebody's profile, which is worse than missing it.
 *
 * Nothing is stored unless a message has a known person in it. A mailbox is
 * read, matched, and mostly discarded — which is the point.
 */

const OUR_DOMAINS = new Set(["facturmfg.com", "bethefactur.com"]);

export type MailSyncReport = {
  account: string;
  matching: number;
  fetched: number;
  attached: number;
  alreadyHad: number;
  hitCap: boolean;
  problem: string | null;
};

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * The identifier a message is deduplicated on.
 *
 * The RFC Message-ID is written by the sender and is the same in every copy, so
 * two recruiters both on a thread produce one row rather than two. Gmail's own
 * id is per-mailbox and is only the fallback for the occasional message that
 * arrives without a Message-ID header.
 */
function keyFor(account: string, m: GmailMessage): string {
  return m.rfcId ?? `${account}:${m.id}`;
}

export async function syncTalentMail(sinceDaysOverride?: number): Promise<MailSyncReport[]> {
  const db = createServiceClient();

  const { data: settings } = await db
    .from("tal_settings")
    .select("mail_accounts,mail_sync_days")
    .maybeSingle();

  const config = settings as { mail_accounts: string[]; mail_sync_days: number } | null;
  const accounts = config?.mail_accounts ?? [];
  const sinceDays = sinceDaysOverride ?? config?.mail_sync_days ?? 30;

  if (!accounts.length) return [];

  // email -> person, built once. A person with four addresses appears four
  // times here, which is what makes the per-message lookup a single get.
  const byEmail = new Map<string, string>();
  let from = 0;
  for (;;) {
    const { data } = await db
      .from("tal_person_emails").select("person_id,email").range(from, from + 999);
    for (const r of (data ?? []) as { person_id: string; email: string }[]) {
      byEmail.set(r.email, r.person_id);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  if (!byEmail.size) return accounts.map((a) => ({
    account: a, matching: 0, fetched: 0, attached: 0, alreadyHad: 0,
    hitCap: false, problem: "Nobody in the database has an email address yet",
  }));

  const { data: types } = await db
    .from("tal_activity_types").select("id,slug").in("slug", ["email-in", "email-out"]);
  const typeBySlug = new Map(
    ((types ?? []) as { id: string; slug: string }[]).map((t) => [t.slug, t.id])
  );

  const reports: MailSyncReport[] = [];

  for (const account of accounts) {
    const report: MailSyncReport = {
      account, matching: 0, fetched: 0, attached: 0, alreadyHad: 0,
      hitCap: false, problem: null,
    };

    try {
      const { messages, matching, hitCap } = await fetchMail(account, TALENT_QUERY, sinceDays);
      report.matching = matching;
      report.fetched = messages.length;
      report.hitCap = hitCap;

      // Only the messages that actually involve somebody we know.
      const candidates: { message: GmailMessage; personId: string; inbound: boolean }[] = [];
      for (const m of messages) {
        let personId: string | undefined;
        for (const p of m.participants) {
          const hit = byEmail.get(p);
          if (hit) { personId = hit; break; }
        }
        if (!personId) continue;
        candidates.push({
          message: m,
          personId,
          inbound: !(m.from && OUR_DOMAINS.has(domainOf(m.from))),
        });
      }

      if (!candidates.length) { reports.push(report); continue; }

      /*
       * Which of these are already filed. The unique index on
       * (external_source, external_id) is partial, so it cannot be an upsert
       * target -- the existing set is read and only the new rows inserted,
       * which is what we want anyway since the count is worth reporting.
       */
      const keys = candidates.map((c) => keyFor(account, c.message));
      const known = new Set<string>();
      for (let i = 0; i < keys.length; i += 200) {
        const { data } = await db
          .from("tal_activities").select("external_id")
          .eq("external_source", "gmail").in("external_id", keys.slice(i, i + 200));
        for (const r of (data ?? []) as { external_id: string }[]) known.add(r.external_id);
      }

      const rows = candidates
        .filter((c) => !known.has(keyFor(account, c.message)))
        .map((c) => ({
          activity_type_id: typeBySlug.get(c.inbound ? "email-in" : "email-out") ?? null,
          person_id: c.personId,
          subject: c.message.subject,
          /*
           * Gmail's snippet, not the body. The trail needs to know a
           * conversation happened, when, and roughly what it said -- not to
           * hold the full correspondence of every candidate in a web app.
           */
          body: c.message.snippet,
          direction: c.inbound ? "inbound" : "outbound",
          external_source: "gmail",
          external_id: keyFor(account, c.message),
          thread_id: c.message.threadId,
          occurred_at: c.message.occurredAt.toISOString(),
          metadata: { mailbox: account, from: c.message.from },
        }));

      report.alreadyHad = candidates.length - rows.length;

      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from("tal_activities").insert(rows.slice(i, i + 200));
        if (error) throw new Error(error.message);
        report.attached += Math.min(200, rows.length - i);
      }
    } catch (e) {
      // One unreachable mailbox must not stop the others: a 403 here means an
      // admin has not granted the scope for that address, which is a setup step
      // for one person rather than a broken sync.
      report.problem = e instanceof Error ? e.message : "Could not read that mailbox";
    }

    reports.push(report);
  }

  const attached = reports.reduce((n, r) => n + r.attached, 0);
  const failed = reports.filter((r) => r.problem).length;
  await db
    .from("tal_settings")
    .update({
      mail_last_sync_at: new Date().toISOString(),
      mail_last_sync_note:
        `${attached} attached across ${reports.length} mailbox${reports.length === 1 ? "" : "es"}` +
        (failed ? `, ${failed} could not be read` : ""),
    })
    .eq("id", true);

  return reports;
}
