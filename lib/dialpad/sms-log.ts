import { createServiceClient } from "@/lib/supabase/server";
import { memberHolding } from "@/lib/dialpad/match";

/*
 * Writing a text down.
 *
 * Keyed on the provider's own message id: a webhook can arrive more than
 * once, and an upsert on (provider, provider_message_id) makes a repeat
 * delivery harmless instead of a duplicate row.
 */

export type SmsProvider = "dialpad";
export type SmsDirection = "inbound" | "outbound";

export type SmsEvent = {
  provider: SmsProvider;
  providerMessageId: string;
  direction: SmsDirection;
  mms: boolean;
  from: string | null;
  to: string | null;
  /** Null unless the subscription was created with message content export enabled. */
  body: string | null;
  /** The Dialpad line this went through -- resolved to member_id via voice_numbers. */
  internalNumber: string | null;
  /** Dialpad's own name for the external party. */
  contactName?: string | null;
  messageStatus?: string | null;
  messageDeliveryResult?: string | null;
  sentAt: string;
  raw?: unknown;
};

export async function recordSms(e: SmsEvent): Promise<void> {
  const db = createServiceClient();
  const memberId = await memberHolding(e.internalNumber);

  const row: Record<string, unknown> = {
    provider: e.provider,
    provider_message_id: e.providerMessageId,
    direction: e.direction,
    mms: e.mms,
    from_number: e.from,
    to_number: e.to,
    body: e.body,
    member_id: memberId,
    contact_name: e.contactName ?? null,
    message_status: e.messageStatus ?? null,
    message_delivery_result: e.messageDeliveryResult ?? null,
    sent_at: e.sentAt,
    updated_at: new Date().toISOString(),
  };
  if (e.raw !== undefined) row.raw = e.raw;

  const { error } = await db.from("sms_messages").upsert(row, { onConflict: "provider,provider_message_id" });
  if (error) throw new Error(`sms_messages upsert failed: ${error.message}`);
}
