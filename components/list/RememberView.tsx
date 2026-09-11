"use client";

import { useEffect } from "react";

/**
 * Remembers which view a list was last opened on, so coming back to the page
 * lands where you left it instead of on the default.
 *
 * A cookie rather than local storage because list pages are server-rendered:
 * the page reads it before the first paint and redirects, so nobody watches
 * the default list appear and then swap for the one they wanted.
 */
export function RememberView({ cookie, query }: { cookie: string; query: string }) {
  useEffect(() => {
    try {
      document.cookie = `${cookie}=${encodeURIComponent(query)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      /* Cookies off. The list still works, it just forgets. */
    }
  }, [cookie, query]);
  return null;
}
