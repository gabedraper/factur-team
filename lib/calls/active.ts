"use client";

import { useEffect, useState } from "react";

/*
 * Whether a call is happening, for anything outside the dialler that needs to
 * know.
 *
 * The dialler owns its own state and always has. What it did not do is say so,
 * and the right rail cannot make sensible decisions -- above all, refusing to
 * fold a panel out from under somebody mid-call -- without knowing.
 *
 * An event on the window rather than a context, because the three dial widgets
 * are rendered in three different branches and are swapped by configuration.
 * Threading a provider through all of them to carry a single boolean would be
 * more moving parts than the fact is worth.
 */

const EVENT = "factur:call-active";

/** Kept outside React so a listener mounting late still learns the truth. */
let active = false;

export function setCallActive(next: boolean) {
  if (active === next) return;
  active = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  }
}

export function useCallActive(): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    // The current value first: a call can already be running when whatever is
    // asking gets mounted.
    setOn(active);
    const handle = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, handle);
    return () => window.removeEventListener(EVENT, handle);
  }, []);

  return on;
}
