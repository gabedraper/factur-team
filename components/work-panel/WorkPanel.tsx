"use client";

import { Phone } from "lucide-react";
import { DialWidget } from "@/components/pipeline/DialWidget";
import { TwilioDialWidget } from "@/components/pipeline/TwilioDialWidget";
import { TelnyxDialWidget } from "@/components/pipeline/TelnyxDialWidget";

/**
 * The persistent right rail -- left is navigation, this is work: whatever a
 * rep is actively doing, regardless of which page they're looking at.
 * Calls today; ClickUp tasks and whatever comes next go here as their own
 * sections later, same pattern as this one.
 */
export function WorkPanel({
  telnyxConfigured, twilioConfigured,
}: {
  telnyxConfigured: boolean;
  twilioConfigured: boolean;
}) {
  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l bg-card/50">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Phone className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Calls</span>
      </div>
      <div className="p-3">
        {telnyxConfigured ? (
          <TelnyxDialWidget />
        ) : twilioConfigured ? (
          <TwilioDialWidget />
        ) : (
          <DialWidget />
        )}
      </div>
    </aside>
  );
}
