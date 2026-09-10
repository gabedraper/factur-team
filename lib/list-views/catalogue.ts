/**
 * Which lists exist, how they can be looked at, and the views everyone gets
 * without asking.
 *
 * Three kinds of view, and only the last is a row in a table:
 *
 *   system  — defined here, identical for everyone. "My opportunities".
 *   scoped  — one definition rendered once per client, never materialised.
 *   saved   — a row in `list_views`, written when somebody presses Save view.
 *
 * Scoped views are deliberately not rows. There are 992 clients of which 156
 * are Active, so giving each a few views would mean thousands of rows that
 * then need hiding, backfilling, and cleaning up whenever a status changes.
 * Rendering them from the client query instead means a new client's views
 * appear on their own and an inactive client's disappear on their own, with
 * nothing to run and nothing to tidy.
 */

/** How a list can be drawn. */
export type Renderer = "table" | "board" | "cards" | "timeline";

/**
 * How a list reaches a client, which is what makes the per-client views
 * possible.
 *
 *   direct          — the row carries client_id. All 780k opportunities do.
 *   via_opportunity — the row is only tied to a client through an opportunity.
 *                     True of target companies and contacts, and it is a
 *                     narrow path: there are 1.28M accounts and most have
 *                     never been worked into an opportunity, so a client's
 *                     "targets" here means only what has already been pursued.
 *   null            — no route to a client, so no per-client views.
 */
export type ClientPath = "direct" | "via_opportunity" | null;

/**
 * How "mine" is answered for a list — a different question from ClientPath,
 * and conflating the two is what first left Clients without a "My clients".
 *
 *   is_client  — the row IS a client, so mine is my_client_ids_direct() itself.
 *   via_client — the row belongs to a client, so mine is rows whose client is.
 *   null       — the list has no notion of "mine" (candidates, sequences).
 */
export type MyScope = "is_client" | "via_client" | null;

export type EntityDef = {
  key: string;
  /** Plural, as it appears in a page title. */
  label: string;
  /** Singular, for buttons — "New opportunity", never "New". */
  singular: string;
  /**
   * The renderers offered in the switcher.
   *
   * Board appears only where the entity has an **ordered pipeline** — a
   * sequence you move something through — not merely a status column. A
   * client's status runs Active / Onboarding / Hold / Inactive, and dragging a
   * client from Active to Inactive is not a thing anyone should be invited to
   * do by a drag target.
   *
   * Cards and timeline are not switcher options. They are chosen by a specific
   * view that wants them, because both answer a narrower question than "show
   * me this list".
   */
  renderers: Renderer[];
  clientPath: ClientPath;
  /** Whether "My ..." and "My team's ..." views apply, and how. */
  myScope: MyScope;
  /**
   * Whether an "All" view is offered.
   *
   * Only where listing everything is cheap. Clients are 992 rows. Opportunities
   * are 780,000, and listing them is a sequential scan of roughly two seconds
   * before any join -- which is why that page refuses to query until a view
   * is chosen, and why it gets no "All".
   */
  allView: boolean;
  /** The column a board groups by, when there is one. */
  stageField?: string;
  /**
   * Whether rows carry a thumbnail.
   *
   * True for companies, false for people, and the asymmetry is the point: a
   * favicon is recognised faster than a name is read, while a person's avatar
   * is nearly always initials -- LinkedIn photos are not obtainable -- so it
   * costs a row's height to repeat what the next column already says.
   */
  rowIdentity: boolean;
};

export const ENTITIES: Record<string, EntityDef> = {
  opportunities: {
    key: "opportunities",
    label: "Opportunities",
    singular: "opportunity",
    // stage is a real pipeline, and tal_candidate_stage_history's equivalent
    // here is opp_stage_changes -- transitions are recorded, so they matter.
    renderers: ["table", "board"],
    stageField: "stage",
    clientPath: "direct",
    myScope: "via_client",
    allView: false,
    rowIdentity: false,
  },
  candidates: {
    key: "candidates",
    label: "Candidates",
    singular: "candidate",
    // tal_workflow_stages gives these an ordered pipeline, and moveCandidate
    // owns the transitions.
    renderers: ["table", "board"],
    stageField: "stage_id",
    clientPath: null,
    myScope: null,
    allView: false,
    rowIdentity: false,
  },
  accounts: {
    key: "accounts",
    label: "Target companies",
    singular: "company",
    renderers: ["table"],
    clientPath: "via_opportunity",
    myScope: "via_client",
    allView: false,
    rowIdentity: true,
  },
  contacts: {
    key: "contacts",
    label: "Target contacts",
    singular: "contact",
    renderers: ["table"],
    clientPath: "via_opportunity",
    myScope: "via_client",
    allView: false,
    rowIdentity: false,
  },
  clients: {
    key: "clients",
    label: "Clients",
    singular: "client",
    // status is a lifecycle, not a pipeline. Table only.
    renderers: ["table"],
    clientPath: null,
    myScope: "is_client",
    allView: true,
    rowIdentity: true,
  },
  sequences: {
    key: "sequences",
    label: "Sequences",
    singular: "sequence",
    renderers: ["table"],
    clientPath: null,
    myScope: null,
    allView: true,
    rowIdentity: false,
  },
};

/**
 * Client statuses whose views are shown.
 *
 * Everything except Inactive, and except the four rows whose status is null —
 * a client nobody has classified should not quietly appear in everyone's view
 * list. Of 992 clients this leaves 215.
 */
export const LIVE_CLIENT_STATUSES = ["Active", "Onboarding", "Hold", "Financial Pause"] as const;

/**
 * A view's stable address, used as the key in `list_view_prefs` so a person's
 * decision to hide or pin something survives across sessions — and, for scoped
 * views, survives even though the view itself is never stored anywhere.
 */
export const viewKey = {
  system: (id: string) => `system:${id}`,
  scopedClient: (clientId: string) => `scoped:client:${clientId}`,
  saved: (id: string) => `saved:${id}`,
};

/** What a resolved view looks like by the time a page renders it. */
export type ResolvedView = {
  key: string;
  label: string;
  kind: "system" | "scoped" | "saved";
  /** Query parameters this view sets. The page turns these into a query. */
  params: Record<string, string>;
  pinned: boolean;
  hidden: boolean;
  position: number;
};

/**
 * The views everyone gets on a list that can reach a client.
 *
 * "Mine" and "my team's" are two different questions and the database already
 * answers both: `my_client_ids_direct()` is the clients you are staffed on
 * yourself, and `my_client_ids()` is the same rolled up through the reporting
 * line. Neither is computed here — this only names them.
 */
export function systemViews(entity: EntityDef): ResolvedView[] {
  const all: ResolvedView[] = entity.allView
    ? [{
        key: viewKey.system("all"),
        label: `All ${entity.label.toLowerCase()}`,
        kind: "system",
        // No parameters: the unfiltered list is the page's own default.
        params: {},
        pinned: true,
        hidden: false,
        position: -1,
      }]
    : [];
  // Asked of myScope, not clientPath. A client has no route "to a client" --
  // it is one -- and yet "My clients" is the most natural view in the app.
  if (!entity.myScope) return all;
  return [
    ...all,
    {
      key: viewKey.system("mine"),
      label: `My ${entity.label.toLowerCase()}`,
      kind: "system",
      params: { scope: "mine" },
      pinned: true,
      hidden: false,
      position: 0,
    },
    {
      key: viewKey.system("team"),
      label: `My team's ${entity.label.toLowerCase()}`,
      kind: "system",
      params: { scope: "team" },
      pinned: true,
      hidden: false,
      position: 1,
    },
  ];
}
