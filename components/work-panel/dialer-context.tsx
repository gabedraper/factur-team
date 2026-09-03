"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type CallTarget = { opportunityId: string; phoneNumber: string | null; contactName: string };

type DialerContextValue = {
  /** Whichever Opportunity page is currently open -- updates as you navigate. */
  active: CallTarget | null;
  setActive: (target: CallTarget | null) => void;
  canAdmin: boolean;
};

const DialerContext = createContext<DialerContextValue | null>(null);

/**
 * Lives in the dashboard layout, not on the Opportunity page -- that's what
 * makes a call survive navigating away from the page that started it. The
 * layout doesn't remount between routes that share it, so this context (and
 * the SDK Device/Call objects the call panel holds) persists across the app
 * the same way the left sidebar does.
 */
export function DialerProvider({ children, canAdmin }: { children: ReactNode; canAdmin: boolean }) {
  const [active, setActive] = useState<CallTarget | null>(null);
  return (
    <DialerContext.Provider value={{ active, setActive, canAdmin }}>
      {children}
    </DialerContext.Provider>
  );
}

export function useDialer() {
  const ctx = useContext(DialerContext);
  if (!ctx) throw new Error("useDialer must be used inside DialerProvider");
  return ctx;
}

/**
 * What a dial widget actually displays: the opportunity currently open in
 * the main pane, UNLESS a call is in progress -- in which case navigating to
 * a different Opportunity shouldn't rewrite who the panel says you're
 * talking to. "Committed" is who a placed call is actually with; it's set at
 * dial time and released once that call is dispositioned.
 */
export function useCallTarget() {
  const { active, canAdmin } = useDialer();
  const [committed, setCommitted] = useState<CallTarget | null>(null);
  return {
    target: committed ?? active,
    canAdmin,
    commit: () => setCommitted(active),
    release: () => setCommitted(null),
  };
}
