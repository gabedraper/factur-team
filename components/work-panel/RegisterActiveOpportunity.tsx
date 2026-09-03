"use client";

import { useEffect } from "react";
import { useDialer } from "@/components/work-panel/dialer-context";

/**
 * Tells the work panel which Opportunity is open, so its Dialer section has
 * someone to call. Doesn't render anything -- the actual call UI lives in
 * WorkPanel, not on this page, so a call survives navigating away.
 */
export function RegisterActiveOpportunity({
  opportunityId, phoneNumber, contactName,
}: {
  opportunityId: string;
  phoneNumber: string | null;
  contactName: string;
}) {
  const { setActive } = useDialer();

  useEffect(() => {
    setActive({ opportunityId, phoneNumber, contactName });
    // Deliberately not cleared on unmount -- navigating to a page with no
    // opportunity of its own (People, Companies, ...) should leave the panel
    // showing whoever you last had open, not go blank.
  }, [opportunityId, phoneNumber, contactName, setActive]);

  return null;
}
