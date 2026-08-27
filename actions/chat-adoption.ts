"use server";

import { chatActivityByPerson } from "@/lib/google/reports";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

/**
 * Chat adoption across the org.
 *
 * The zeroes are the point. Reading the audit log alone tells you who sent
 * something; the question people actually ask is who has not, and that answer
 * only exists once the log is set against the staff list. So this starts from
 * everyone active and attaches counts to them, rather than the other way
 * round -- somebody who has never opened Chat has no row in Google's report
 * and would otherwise quietly not appear in the answer at all.
 */

export type Adoption = {
  email: string;
  name: string | null;
  messages: number;
  lastActive: string | null;
};

export type AdoptionReport = {
  people: Adoption[];
  from: string;
  truncated: boolean;
  /** Sent something, but is not on the staff list. */
  strangers: Adoption[];
  problem: string | null;
};

export async function chatAdoption(days = 30): Promise<AdoptionReport> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return {
      people: [], strangers: [], from: "", truncated: false,
      problem: "Not permitted.",
    };
  }

  const report = await chatActivityByPerson(days);

  const { data } = await createServiceClient()
    .from("org_members")
    .select("email, full_name")
    .eq("active", true);

  const members = (data ?? []) as { email: string; full_name: string | null }[];
  const byEmail = new Map(
    report.people.map((p) => [p.email.toLowerCase(), p])
  );

  const people: Adoption[] = members
    .map((m) => {
      const hit = byEmail.get(m.email.toLowerCase());
      return {
        email: m.email,
        name: m.full_name,
        messages: hit?.messages ?? 0,
        lastActive: hit?.lastActive ?? null,
      };
    })
    .sort((a, b) => b.messages - a.messages || a.email.localeCompare(b.email));

  /*
   * Anyone Google counted who is not on the staff list.
   *
   * Worth surfacing rather than dropping: the comms ingest already turned up
   * an address sending plenty of chat that org_members has never heard of, and
   * silently discarding those rows is how that stayed unnoticed.
   */
  const known = new Set(members.map((m) => m.email.toLowerCase()));
  const strangers = report.people
    .filter((p) => !known.has(p.email.toLowerCase()))
    .map((p) => ({ ...p, name: null }));

  return {
    people,
    strangers,
    from: report.from,
    truncated: report.truncated,
    problem: report.problem,
  };
}
