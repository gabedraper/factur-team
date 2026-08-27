"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordPageView } from "@/actions/page-timing";

/**
 * How long each page actually took, measured in the browser.
 *
 * Server time alone answers a different question. A page can be served in 80ms
 * and still sit blank for a second afterwards, and the person waiting calls
 * that slow whatever the server logs say -- so this measures the wait they
 * had, not the work we did.
 *
 * Arrivals and moves are recorded apart because they are not the same event.
 * Landing on a URL pays for the document, the scripts and the first render;
 * clicking through inside the app pays only a server round trip. Averaged
 * together they make a number that describes neither.
 */
export function PageTiming() {
  const pathname = usePathname();
  const arrived = useRef(false);

  // A fresh arrival. The browser has already timed this one for us.
  useEffect(() => {
    if (typeof performance === "undefined") return;

    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (!nav) return;

    /*
     * loadEventEnd is zero while the load event is still pending, which is
     * exactly the state this runs in. Waiting for the event rather than reading
     * it early is the difference between a real number and a zero on every row.
     */
    const send = () => {
      const ms = Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd);
      if (ms > 0) void recordPageView(window.location.pathname, "load", ms);
    };

    if (document.readyState === "complete") {
      send();
      return;
    }
    window.addEventListener("load", send, { once: true });
    return () => window.removeEventListener("load", send);
  }, []);

  /*
   * A move inside the app.
   *
   * Next fetches the new route over the network with `_rsc` on the query
   * string, so the browser's resource timings already hold the real round trip
   * -- no need to approximate it with a timer started whenever React happens
   * to re-render.
   *
   * Only the route actually arrived at is read. Next prefetches links on hover
   * and in the viewport, and those fetches sit in the same timing buffer;
   * counting them would give pages nobody opened a stream of views. Matching
   * on the path just navigated to leaves them out, because a link never
   * followed never becomes the current path.
   *
   * A page that was prefetched and then clicked reports the prefetch's
   * duration. That is still the honest server cost of the route -- the wait
   * simply happened before the click rather than after it.
   */
  useEffect(() => {
    if (typeof performance === "undefined") return;

    // The first pass is the arrival above, already counted.
    if (!arrived.current) {
      arrived.current = true;
      return;
    }

    const entries = performance.getEntriesByType("resource");
    let ms = 0;

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry.name.includes("_rsc=")) continue;
      try {
        if (new URL(entry.name).pathname !== pathname) continue;
      } catch {
        continue;
      }
      ms = Math.round(entry.duration);
      break;
    }

    if (ms > 0) void recordPageView(pathname, "route", ms);
  }, [pathname]);

  return null;
}
