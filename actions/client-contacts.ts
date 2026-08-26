"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { ROLES, type Contact, type Role } from "@/lib/client-contacts";

/*
 * The people we email at a client.
 *
 * Salesforce owns the decision maker, QuickBooks owns the billing address, and
 * both are routinely wrong about who actually reads the mail. So a sync writes
 * rows marked with its own source, a person writes rows marked 'manual', and
 * client_contact_current prefers the manual one -- the same shape as the team
 * lead override. Correcting something here should survive the next sync.
 */


async function mayEdit(): Promise<boolean> {
  const perms = await myPermissions();
  return perms.has("org.manage") || perms.has("nps.send");
}

async function whoAmI(): Promise<string> {
  const { data } = await (await createClient()).auth.getUser();
  return data.user?.email ?? "unknown";
}

export async function listClientContacts(clientId: string): Promise<Contact[]> {
  const { data } = await createServiceClient()
    .from("client_contacts")
    .select("id,email,first_name,last_name,role,source,active,opted_out_at,opted_out_reason,bounced_at")
    .eq("client_id", clientId)
    .order("role")
    .order("source");
  return (data ?? []) as Contact[];
}

export async function addClientContact(
  clientId: string,
  email: string,
  firstName: string,
  lastName: string,
  role: Role
) {
  if (!(await mayEdit())) return { success: false, error: "Not permitted." };

  const address = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return { success: false, error: "That doesn't look like an email address." };
  }
  if (!ROLES.includes(role)) return { success: false, error: "Unknown role." };

  const { error } = await createServiceClient().from("client_contacts").insert({
    client_id: clientId,
    email: address,
    first_name: firstName.trim() || null,
    last_name: lastName.trim() || null,
    role,
    // Added by a person, so it outranks whatever the sync says for this role.
    source: "manual",
    updated_by: await whoAmI(),
  });

  if (error) {
    return {
      success: false,
      error: /duplicate|unique/i.test(error.message)
        ? "That address is already on this client in that role."
        : error.message,
    };
  }

  revalidatePath(`/settings/clients/${clientId}`);
  return { success: true };
}

/**
 * Stop emailing someone, or start again.
 *
 * A row rather than a deletion: a client who asked not to be surveyed has to
 * stay on record, or the next sync puts their address straight back and the
 * next campaign emails them again.
 */
export async function setContactOptOut(
  contactId: string,
  clientId: string,
  optedOut: boolean,
  reason: string
) {
  if (!(await mayEdit())) return { success: false, error: "Not permitted." };

  const { error } = await createServiceClient()
    .from("client_contacts")
    .update({
      opted_out_at: optedOut ? new Date().toISOString() : null,
      opted_out_reason: optedOut ? reason.trim() || null : null,
      updated_at: new Date().toISOString(),
      updated_by: await whoAmI(),
    })
    .eq("id", contactId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/clients/${clientId}`);
  revalidatePath("/settings/nps");
  return { success: true };
}

/** For a contact that was mistyped, or one a sync invented. */
export async function removeClientContact(contactId: string, clientId: string) {
  if (!(await mayEdit())) return { success: false, error: "Not permitted." };

  const { error } = await createServiceClient()
    .from("client_contacts")
    .delete()
    .eq("id", contactId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/settings/clients/${clientId}`);
  return { success: true };
}
