/*
 * Desktop notifications, for the reply that arrives after you have looked away.
 *
 * Answers take a while now -- Gaib often reads something before it speaks -- so
 * people ask a question and go back to what they were doing. Without this the
 * reply sits in a panel behind three other tabs until they happen to look.
 *
 * Deliberately only covers the case where the app is still open. The harder
 * case, telling somebody about a fix days later when they are nowhere near a
 * browser, is not something this can reach, and pretending otherwise would mean
 * building the wrong thing here.
 */

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

export function permissionState(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotifyPermission;
}

/**
 * Whether it is worth offering.
 *
 * "denied" is a dead end and must never produce an offer: once somebody has
 * refused, the browser will not ask again, and a button that silently does
 * nothing is worse than no button.
 */
export function canAsk(): boolean {
  return permissionState() === "default";
}

/**
 * Ask, from inside a click.
 *
 * Safari requires the request to come from something the person actually did,
 * so every caller has to be a click handler rather than an effect. It is also
 * the right behaviour regardless: a permission box that appears unprompted gets
 * refused, and a refusal is permanent.
 */
export async function ask(): Promise<NotifyPermission> {
  if (permissionState() !== "default") return permissionState();
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return "denied";
  }
}

/**
 * Show one, but only if they are genuinely elsewhere.
 *
 * hasFocus() rather than visibilityState: a window sitting visible behind the
 * one being typed in is still a window nobody is reading, and notifying for a
 * reply somebody is watching arrive is the fastest way to get notifications
 * switched off.
 */
export function notify(body: string, onClick?: () => void): void {
  if (permissionState() !== "granted") return;
  if (typeof document !== "undefined" && document.hasFocus()) return;

  try {
    const n = new Notification("Gaib", {
      body: body.slice(0, 180),
      // Replaces rather than stacks. Three unread answers should be one badge,
      // not three boxes to dismiss.
      tag: "gaib-reply",
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      n.close();
      onClick?.();
    };
  } catch {
    // Some browsers refuse to construct one outside a service worker. Nothing
    // to do about it and nothing worth breaking the reply over.
  }
}
