"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { expandCallsPanel } from "@/lib/calls/expand";

export type CallTarget = { opportunityId: string; phoneNumber: string | null; contactName: string };

/**
 * Something outside the dial widgets asking for a call. With a target it is a
 * call to that Opportunity's contact -- tagged with its id and logged against
 * it, exactly as if the Call button on its page had been pressed. Without one
 * it is an ad hoc number, attributed to nothing.
 */
export type CallRequest = { number: string; target: CallTarget | null };

type DialerContextValue = {
  /** Whichever Opportunity page is currently open -- updates as you navigate. */
  active: CallTarget | null;
  setActive: (target: CallTarget | null) => void;
  canAdmin: boolean;
  /**
   * A call something outside the dial widgets has asked for. Whichever
   * provider is actually live watches this and places the call; the
   * requester doesn't need to know which provider that is or how it dials.
   */
  requestedCall: CallRequest | null;
  /**
   * Dial a number that belongs to no Opportunity -- a contact on Target
   * Contacts or Target Companies. It is not tagged, and no "log a call"
   * dialog follows it: the panel's contact is just whichever Opportunity was
   * last opened, which has nothing to do with this call.
   */
  requestCall: (number: string) => void;
  /**
   * Call this Opportunity's contact from somewhere that is not its page -- a
   * row on the Opportunities list. It becomes the panel's contact first, so
   * the name shown, the call's tag and the "log a call" dialog afterwards all
   * point at the record that was clicked rather than the last one opened.
   */
  callOpportunity: (target: CallTarget) => void;
  clearRequestedCall: () => void;
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
  const [requestedCall, setRequestedCall] = useState<CallRequest | null>(null);
  return (
    <DialerContext.Provider
      value={{
        active, setActive, canAdmin,
        requestedCall,
        // Ask the panel to un-collapse before the widget needs to be there to
        // receive this -- see lib/calls/expand.ts.
        requestCall: (number: string) => { expandCallsPanel(); setRequestedCall({ number, target: null }); },
        callOpportunity: (target: CallTarget) => {
          expandCallsPanel();
          setActive(target);
          setRequestedCall({ number: target.phoneNumber ?? "", target });
        },
        clearRequestedCall: () => setRequestedCall(null),
      }}
    >
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
  const { active, canAdmin, requestedCall, clearRequestedCall } = useDialer();
  const [committed, setCommitted] = useState<CallTarget | null>(null);
  return {
    target: committed ?? active,
    canAdmin,
    commit: () => setCommitted(active),
    release: () => setCommitted(null),
    requestedCall,
    clearRequestedCall,
  };
}

/**
 * Places whatever call was requested from outside the panel. Shared by all
 * three providers so they cannot disagree about who a call is with.
 *
 * A request for an Opportunity has to wait until the panel is showing that
 * Opportunity. Usually it already is -- callOpportunity sets it in the same
 * breath -- but a call that ended without being logged leaves its contact
 * committed, and dialing on top of that would tag the new call, and log it,
 * against the old contact. So the old one is released first and the call goes
 * out on the next render. During a live call it is refused outright: releasing
 * then would rewrite who the panel says you are talking to, mid-sentence.
 */
export function usePlaceRequestedCall({
  target, live, release, requestedCall, clearRequestedCall, place, refuse,
}: {
  target: CallTarget | null;
  live: boolean;
  release: () => void;
  requestedCall: CallRequest | null;
  clearRequestedCall: () => void;
  /** No number means "this Opportunity's own contact". */
  place: (overrideNumber?: string) => void;
  refuse: (message: string) => void;
}) {
  useEffect(() => {
    if (!requestedCall) return;
    const wanted = requestedCall.target;
    if (wanted && target?.opportunityId !== wanted.opportunityId) {
      if (live) {
        refuse("Hang up the current call before starting another.");
        clearRequestedCall();
      } else {
        release();
      }
      return;
    }
    place(wanted ? undefined : requestedCall.number);
    clearRequestedCall();
    // place/refuse close over this render's state, which is what we want --
    // only a new request, or the panel catching up to one, should fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedCall, target?.opportunityId]);
}
