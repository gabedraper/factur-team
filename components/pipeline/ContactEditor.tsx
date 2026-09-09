"use client";

import { Phone as PhoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/pipeline/bits";
import { useDialer } from "@/components/work-panel/dialer-context";
import { toE164 } from "@/lib/phone";

/**
 * Read-only on purpose: crm_contacts is a one-way Salesforce sync (see
 * lib/integrations/catalogue.ts), so an edit made here can't push back and
 * gets silently overwritten the next time that sync runs. An editable
 * version of this panel existed briefly but never actually stuck -- the
 * save button looked permanently "dirty" because nothing here re-fetched
 * the saved value afterward, which read as "isn't saving" even when it
 * technically was. Fixing that properly wasn't worth it for a value this
 * panel doesn't own; wrong numbers get fixed in Salesforce.
 */
export function ContactEditor({
  phone, email, industry,
}: {
  phone: string | null;
  email: string | null;
  industry: string | null;
}) {
  const { requestCall } = useDialer();
  const dialableNumber = toE164(phone);

  return (
    <Panel title="Contact">
      <dl className="space-y-2 p-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="flex items-center gap-2 tabular-nums">
            {phone ?? "—"}
            {phone && (
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-6 w-6"
                title={dialableNumber ? `Call ${dialableNumber}` : "This number doesn't look valid"}
                disabled={!dialableNumber}
                onClick={() => dialableNumber && requestCall(dialableNumber)}
              >
                <PhoneIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate">{email ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Industry</dt>
          <dd>{industry ?? "—"}</dd>
        </div>
      </dl>
    </Panel>
  );
}
