import type { WorkItem } from "@/lib/work";

/**
 * Where in this app a mirrored ClickUp task belongs.
 *
 * The mirror already sends people out to ClickUp; this is the return journey.
 * A task about a client's targeting is *about* the leads page, and until the
 * row says so the link only runs one way -- out of the app and into the tool we
 * are trying to leave.
 *
 * Resolution is by process first, because the process is what says which part
 * of a client the work concerns. A client with no process falls back to the
 * client record, which is never wrong, only vague.
 */

export type Destination = { href: string; label: string };

/** Processes that concern a specific screen rather than the client record. */
const BY_PROCESS: Record<string, (clientId: string) => string> = {
  targeting: (id) => `/clients/${id}/leads`,
  "service-delivery": (id) => `/clients/${id}/activities`,
  content: (id) => `/clients/${id}/activities`,
};

export function appDestination(item: WorkItem): Destination | null {
  /*
   * An opportunity is more specific than the client that owns it, so it wins.
   * Nothing sets it yet -- the matcher only fills client_id today -- but the
   * ordering is the part worth fixing now, not later under pressure.
   */
  if (item.opportunityId) {
    return { href: `/opportunities/${item.opportunityId}`, label: "Opportunity" };
  }

  if (item.clientId) {
    const route = item.processSlug ? BY_PROCESS[item.processSlug] : undefined;
    return {
      href: route ? route(item.clientId) : `/clients/${item.clientId}`,
      label: item.clientName ?? "Client",
    };
  }

  return null;
}
