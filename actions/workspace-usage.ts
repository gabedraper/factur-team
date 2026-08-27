"use server";

import { workspaceUsage, type AppUsage } from "@/lib/google/usage";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";

/**
 * Gmail, Drive, Docs and Chat, one row per member of staff.
 *
 * Built from the staff list outward rather than from Google's report inward,
 * for the same reason the chat count is: somebody who has used none of it has
 * no row in the report, and reading the report straight would leave exactly
 * the people the question is about out of the answer.
 */

export type UsageRow = AppUsage & { name: string | null; onStaff: boolean };

export type WorkspaceUsageReport = {
  rows: UsageRow[];
  date: string | null;
  seen: string[];
  problem: string | null;
};

export async function workspaceUsageByPerson(): Promise<WorkspaceUsageReport> {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) {
    return { rows: [], date: null, seen: [], problem: "Not permitted." };
  }

  const report = await workspaceUsage();

  const { data } = await createServiceClient()
    .from("org_members")
    .select("email, full_name")
    .eq("active", true);

  const members = (data ?? []) as { email: string; full_name: string | null }[];
  const byEmail = new Map(report.people.map((p) => [p.email.toLowerCase(), p]));
  const known = new Set(members.map((m) => m.email.toLowerCase()));

  const empty = { gmail: null, drive: null, docs: null, chat: null, lastLogin: null };

  const staff: UsageRow[] = members.map((m) => ({
    ...empty,
    ...(byEmail.get(m.email.toLowerCase()) ?? {}),
    email: m.email,
    name: m.full_name,
    onStaff: true,
  }));

  // Anyone Google knows about who the staff list does not, kept for the same
  // reason as in the chat report: dropping them is how one gets missed.
  const others: UsageRow[] = report.people
    .filter((p) => !known.has(p.email.toLowerCase()))
    .map((p) => ({ ...p, name: null, onStaff: false }));

  /*
   * Least active first.
   *
   * The question this gets opened for is who is not using something, so the
   * answer should not be at the bottom of seventy rows. Ranked by how many of
   * the four a person has never touched.
   */
  const idle = (r: UsageRow) =>
    [r.gmail, r.drive, r.docs, r.chat].filter((v) => !v).length;

  staff.sort((a, b) => idle(b) - idle(a) || (a.name ?? a.email).localeCompare(b.name ?? b.email));

  return {
    rows: [...staff, ...others],
    date: report.date,
    seen: report.seen,
    problem: report.problem,
  };
}
