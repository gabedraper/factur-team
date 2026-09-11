/*
 * What the header search can look through, in picker order.
 *
 * One list shared by the search box, the results page and the server action,
 * so the picker, the page's tabs and what actually gets queried cannot drift.
 * The keys are the p_object values search_records() accepts.
 *
 * "Target" contacts and companies: the ones on a client pipeline the viewer
 * can see, same as the Target Contacts and Target Companies screens -- not the
 * whole CRM directory under /data, which is a different question.
 */

export type SearchObject = "opportunity" | "contact" | "company" | "client" | "person";
export type SearchScope = SearchObject | "all";

export type SearchObjectDef = {
  key: SearchObject;
  label: string;
  /** Who may search it. The database checks again; this decides what to offer. */
  needs: "pipeline" | "talent" | "any";
};

export const SEARCH_OBJECTS: SearchObjectDef[] = [
  { key: "opportunity", label: "Opportunities", needs: "pipeline" },
  { key: "contact", label: "Target contacts", needs: "pipeline" },
  { key: "company", label: "Target companies", needs: "pipeline" },
  { key: "client", label: "Clients", needs: "any" },
  { key: "person", label: "Talent", needs: "talent" },
];

export const OBJECT_LABEL = Object.fromEntries(SEARCH_OBJECTS.map((o) => [o.key, o.label])) as Record<
  SearchObject,
  string
>;

export function isSearchObject(v: string | null | undefined): v is SearchObject {
  return SEARCH_OBJECTS.some((o) => o.key === v);
}

export type SearchHit = {
  object: SearchObject;
  id: string;
  title: string | null;
  subtitle: string | null;
  opportunity_id: string | null;
  client_id: string | null;
};

export type SearchGroup = {
  object: SearchObject;
  hits: SearchHit[];
  /** More matched than were returned. */
  more: boolean;
  /** Set when this object's query failed -- shown as a failure, never as "no matches". */
  error?: string;
};

/*
 * Where a hit opens. Contacts have no page of their own -- a target contact is
 * a pursuit -- so they open their most recently touched opportunity. Target
 * companies open inside their client's list, with the company's panel up.
 */
export function hrefFor(hit: SearchHit): string {
  switch (hit.object) {
    case "opportunity":
      return `/opportunities/${hit.id}`;
    case "contact":
      return `/opportunities/${hit.opportunity_id}`;
    case "company":
      return `/pipeline/${hit.client_id}?account=${hit.id}`;
    case "client":
      return `/clients/${hit.id}`;
    case "person":
      return `/talent/people/${hit.id}`;
  }
}

/*
 * The picker starts on whatever the current page lists -- Salesforce does the
 * same -- so searching from Opportunities searches opportunities without a
 * click. Anywhere else it starts on All. Most specific prefix first.
 */
const ROUTE_DEFAULTS: [string, SearchObject][] = [
  ["/opportunities", "opportunity"],
  ["/pipeline/contacts", "contact"],
  ["/pipeline", "company"],
  ["/clients", "client"],
  ["/talent/people", "person"],
];

export function defaultScopeFor(pathname: string, allowed: SearchObject[]): SearchScope {
  for (const [prefix, object] of ROUTE_DEFAULTS) {
    if ((pathname === prefix || pathname.startsWith(prefix + "/")) && allowed.includes(object)) return object;
  }
  return "all";
}
