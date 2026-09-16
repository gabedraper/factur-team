"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { addToSequence, listSequences, type SequenceRow } from "@/actions/sequence-audience";
import { ROLES, type Role } from "@/lib/client-contacts";

/*
 * Reaching the clients somebody has selected on a list.
 *
 * The rule this file exists to keep is the one collections states plainly: the
 * browser says which clients and which kind of contact, and the server decides
 * the addresses. A screen that posted a list of email addresses would be a way
 * to send mail from a colleague's mailbox to anywhere at all, which is why
 * nothing here accepts one.
 *
 * Addresses come from client_contact_current, never from client_contacts
 * directly. That view is where "do not email this person" is enforced -- it
 * drops opted-out and bounced rows and picks one address per client per role,
 * preferring a hand-entered correction over a synced one. Reading the table
 * underneath it would be how an opt-out quietly stops counting.
 */

export type Recipient = {
  clientId: string;
  clientName: string;
  email: string;
  role: Role;
  name: string | null;
};

export type Unreachable = {
  clientId: string;
  clientName: string;
  /** Said in the words the screen will use. */
  why: string;
};

export type RecipientPreview = {
  recipients: Recipient[];
  unreachable: Unreachable[];
  error?: string;
};

async function mayEnrol() {
  const perms = await myPermissions();
  return perms.has("sequences.send") || perms.has("org.manage");
}

async function maySeeClients() {
  const perms = await myPermissions();
  return perms.has("clients.health") || perms.has("clients.results") || perms.has("org.manage");
}

/** The sequences somebody could add clients to. */
export async function outreachSequences(): Promise<SequenceRow[]> {
  if (!(await mayEnrol())) return [];
  return listSequences();
}

/**
 * Who would actually be written to, and who would be missed.
 *
 * Both halves are the point. A client with no address does not fail loudly
 * anywhere else in the app -- it is simply absent from the result -- and a
 * person sending an announcement to their book needs to see the gap before
 * they send it, not discover it when somebody complains they were not told.
 */
export async function previewClientRecipients(
  clientIds: string[],
  roles: Role[],
): Promise<RecipientPreview> {
  if (!(await maySeeClients())) {
    return { recipients: [], unreachable: [], error: "Not permitted." };
  }

  const wantedRoles = roles.filter((r) => (ROLES as readonly string[]).includes(r));
  if (clientIds.length === 0) return { recipients: [], unreachable: [] };
  if (wantedRoles.length === 0) {
    return { recipients: [], unreachable: [], error: "Pick at least one kind of contact." };
  }

  const db = createServiceClient();

  const [{ data: clients, error: clientError }, { data: contacts, error: contactError }] =
    await Promise.all([
      db.from("org_clients").select("id,name").in("id", clientIds),
      db
        .from("client_contact_current")
        .select("client_id,email,first_name,last_name,role")
        .in("client_id", clientIds)
        .in("role", wantedRoles),
    ]);

  if (clientError) return { recipients: [], unreachable: [], error: clientError.message };
  if (contactError) return { recipients: [], unreachable: [], error: contactError.message };

  const nameOf = new Map(
    ((clients ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );

  const rows = (contacts ?? []) as {
    client_id: string; email: string;
    first_name: string | null; last_name: string | null; role: Role;
  }[];

  /*
   * One message per address. Somebody who is both the main contact and the
   * decision maker is one person and should not get the same announcement
   * twice; the sequence would refuse the second anyway, but silently.
   */
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const r of rows) {
    const key = r.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      clientId: r.client_id,
      clientName: nameOf.get(r.client_id) ?? "",
      email: key,
      role: r.role,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
    });
  }

  const reached = new Set(rows.map((r) => r.client_id));
  const unreachable: Unreachable[] = clientIds
    .filter((id) => !reached.has(id))
    .map((id) => ({
      clientId: id,
      clientName: nameOf.get(id) ?? "",
      why: "No address on file for that kind of contact",
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  recipients.sort((a, b) => a.clientName.localeCompare(b.clientName));
  return { recipients, unreachable };
}

/**
 * Put the people at the selected clients onto a sequence.
 *
 * The addresses are resolved again here rather than taken from the preview the
 * browser was shown. The preview is a courtesy; this is the decision, and the
 * two being the same query means a stale screen cannot enrol somebody who
 * opted out in the minutes between.
 */
export async function addClientsToSequence(
  slug: string,
  clientIds: string[],
  roles: Role[],
): Promise<{ success: boolean; error?: string; added?: number; alreadyIn?: number; missed?: number }> {
  if (!(await mayEnrol())) return { success: false, error: "Not permitted." };

  const preview = await previewClientRecipients(clientIds, roles);
  if (preview.error) return { success: false, error: preview.error };
  if (preview.recipients.length === 0) {
    return { success: false, error: "None of those clients has an address on file." };
  }

  const res = await addToSequence(
    slug,
    preview.recipients.map((r) => ({
      email: r.email,
      firstName: r.name ? r.name.split(" ")[0] : null,
      lastName: r.name && r.name.includes(" ") ? r.name.split(" ").slice(1).join(" ") : null,
      company: r.clientName,
      clientId: r.clientId,
      problem: null,
    })),
  );

  if (!res.success) return res;
  return { ...res, missed: preview.unreachable.length };
}
