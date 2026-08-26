/**
 * What a client contact is, apart from the server actions that read and write
 * them.
 *
 * Its own file because a "use server" module may only export async functions --
 * a plain constant like ROLES exported from actions/client-contacts.ts fails
 * the build, and the types have to travel with it to stay in one place.
 */

export const ROLES = ["primary", "decision_maker", "billing"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  primary: "Primary",
  decision_maker: "Decision maker",
  billing: "Billing",
};

export type ContactSource = "salesforce" | "quickbooks" | "manual";

export const SOURCE_LABEL: Record<ContactSource, string> = {
  salesforce: "Salesforce",
  quickbooks: "QuickBooks",
  manual: "Added here",
};

export type Contact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: Role;
  source: ContactSource;
  active: boolean;
  opted_out_at: string | null;
  opted_out_reason: string | null;
  bounced_at: string | null;
};
