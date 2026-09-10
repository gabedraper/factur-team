"use client";

import { useEffect } from "react";

/*
 * "Somebody wants the dialer on screen right now."
 *
 * requestCall() (dialer-context.tsx) can fire while the work panel is
 * collapsed or its Calls section is folded shut -- both of which fully
 * unmount the dial widget (see WorkPanel.tsx), so there would be nothing
 * listening for the requested call at all. The widget can't rescue itself
 * from that state since it doesn't exist yet; the panel has to be told to
 * open before the widget mounts and picks the call up.
 *
 * Same event-on-window shape as lib/calls/active.ts and for the same reason:
 * the panel and whichever component calls requestCall() have no shared
 * parent worth threading a callback through.
 */

const EVENT = "factur:expand-calls-panel";

export function expandCallsPanel() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

export function useExpandCallsSignal(onExpand: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, onExpand);
    return () => window.removeEventListener(EVENT, onExpand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
