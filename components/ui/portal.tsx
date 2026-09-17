"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/*
 * Render an overlay at the top of the document rather than where it was written.
 *
 * A panel is written inside the thing it belongs to, which reads well and
 * positions badly. `fixed inset-0` promises the whole viewport, and then the
 * page it was written into quietly takes some of it back:
 *
 * - `space-y-3` on the parent sets margin-top on every child but the first, and
 *   a fixed element is still a child. That is a 12px strip of page showing
 *   above the panel and 12px missing off the bottom -- the gap that kept coming
 *   back on one panel after another.
 * - An ancestor with a transform, a filter or a container-type stops being
 *   ordinary and becomes what `fixed` is measured against, so the panel lands
 *   inside a column instead of over the window.
 * - An ancestor with `overflow: hidden` clips it.
 *
 * None of those are visible in the panel's own markup, which is what makes them
 * expensive: the panel looks right, and breaks because of a class somebody
 * added three files away. Sending it to document.body ends the whole family of
 * them at once.
 *
 * Mounted first, because the server has no document to render into and React
 * must produce the same markup on both sides of the handover.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return createPortal(children, document.body);
}
