import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePipeline } from "@/lib/pipeline/access";
import { myPermissions } from "@/lib/org";
import { listOpportunities, getView } from "@/actions/opportunity-views";
import { knownColumns, DEFAULT_COLUMNS, type ListView } from "@/lib/pipeline/list-views";
import { resolveViews } from "@/lib/list-views/resolve";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { ViewSwitcher } from "@/components/list/ViewSwitcher";
import { RendererSwitch } from "@/components/list/RendererSwitch";
import { RememberView } from "@/components/list/RememberView";
import { ListEmpty } from "@/components/list/EmptyState";
import { OpportunityTable, OpportunityBoard, type Row } from "@/components/pipeline/OpportunityList";
import { OpportunityViewTools, NewViewButton } from "@/components/pipeline/OpportunityViewEditor";

export const dynamic = "force-dynamic";

/*
 * Opportunities, on the same shell as every other list: title, view chips,
 * filters, rows -- and every one of those held in the URL.
 *
 * The views come from lib/list-views: "My opportunities" and "My team's" for
 * everyone, one per live client behind "More…", and whatever people have
 * saved. Opening a view is following a link, so the back button, a reload and
 * a pasted link all land on the same list.
 *
 * There is no "All opportunities". Listing all 780,000 is a sequential scan of
 * about two seconds before any join, for a question nobody has asked -- so a
 * visit with no view goes to the one this browser used last, or to "My
 * opportunities", which answers from an index in tens of milliseconds.
 *
 * ?none=1 is "no view selected": what the × on the selected chip goes to. It
 * runs no query and shows nothing but the chips and a way to make a new view.
 * It is not remembered -- the cookie keeps only the view keys -- so coming
 * back to the page later lands on "My opportunities", not on a blank list.
 */

const PAGE = 50;
const BOARD_LIMIT = 200;
const REMEMBER = "opp_list_query";
/* The parameters that choose a view. Only these are remembered; a search or a
   page number is not somewhere anybody wants to be returned to. */
const VIEW_KEYS = ["scope", "client", "view", "as"] as const;
/* A board needs these whatever the view's own columns are. */
const BOARD_COLUMNS = ["contact_name", "account_name", "client_name", "stage", "next_action_date"];

type Search = { scope?: string; client?: string; view?: string; q?: string; page?: string; as?: string; none?: string };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePipeline("view");
  const sp = await searchParams;

  const none = sp.none === "1" && !sp.scope && !sp.client && !sp.view;

  if (!sp.scope && !sp.client && !sp.view && !none) {
    const jar = await cookies();
    const remembered = new URLSearchParams(jar.get(REMEMBER)?.value ?? "");
    const kept = new URLSearchParams();
    for (const k of VIEW_KEYS) {
      const v = remembered.get(k);
      if (v) kept.set(k, v);
    }
    // The previous version of this page remembered a saved view's id alone.
    const legacy = jar.get("opp_list_view")?.value;
    if (![...kept.keys()].some((k) => k !== "as") && legacy) kept.set("view", legacy);
    if (![...kept.keys()].some((k) => k !== "as")) kept.set("scope", "mine");
    redirect(`/opportunities/my?${kept.toString()}`);
  }

  const scope = sp.scope === "mine" || sp.scope === "team" ? sp.scope : null;
  const board = sp.as === "board";
  const q = (sp.q ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const [views, perms, saved] = await Promise.all([
    resolveViews("opportunities"),
    myPermissions(),
    sp.view ? getView(sp.view) : Promise.resolve(null),
  ]);
  const canShare = perms.has("org.manage");

  let rows: Row[] = [];
  let hasMore = false;
  let tooBroad = false;
  let error: string | null = null;

  if (none) {
    // Nothing selected, so nothing to ask the database.
  } else if (sp.view && !saved) {
    error = "That view has been deleted, or is private to somebody else.";
  } else {
    try {
      const res = await listOpportunities({
        columns: board ? BOARD_COLUMNS : saved?.columns ?? DEFAULT_COLUMNS,
        filters: saved?.filters ?? [],
        sortField: saved?.sort_field ?? null,
        sortDir: saved?.sort_dir ?? "asc",
        search: q,
        clientId: sp.client ?? null,
        scope,
        page: board ? 0 : page,
        limit: board ? BOARD_LIMIT : PAGE,
      });
      ({ rows, hasMore, tooBroad } = res);
    } catch (e) {
      error = e instanceof Error ? e.message : "The query failed.";
    }
  }

  const columns = knownColumns(saved?.columns ?? DEFAULT_COLUMNS);

  /* Builds a link to this list with some parameters changed. Anything set to
     null is dropped, which is how "clear the search" and "first page" work. */
  const href = (patch: Partial<Record<keyof Search, string | null>>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/opportunities/my?${next.toString()}`;
  };

  const viewQuery = new URLSearchParams();
  for (const k of VIEW_KEYS) if (sp[k]) viewQuery.set(k, sp[k]!);

  /* A private view is its owner's to change; a shared one is an admin's. RLS
     only returns private views to their owner, so "private" means "yours". */
  const editable: ListView | null = saved && (!saved.shared || canShare) ? saved : null;

  const activeFilters = q ? [`“${q}”`] : [];

  const clearQuery = new URLSearchParams({ none: "1" });
  if (sp.as) clearQuery.set("as", sp.as);
  const clearHref = `/opportunities/my?${clearQuery.toString()}`;

  return (
    <div className="space-y-4 p-section">
      <RememberView cookie={REMEMBER} query={viewQuery.toString()} />
      <PageHeader
        title="Opportunities"
        /* No exact total: a count over a broad view costs more than the page it
           labels. "50+" is what is actually known. */
        count={none || error || tooBroad ? undefined : `${rows.length}${hasMore ? "+" : ""}`}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {/* useSearchParams inside needs a boundary. */}
        <Suspense fallback={<div className="h-7" />}>
          <ViewSwitcher entity="opportunities" pinned={views.pinned} rest={views.rest} clearHref={clearHref} />
        </Suspense>
        <OpportunityViewTools current={editable} canShare={canShare} />
      </div>

      {none ? (
        <Surface>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-body text-muted-foreground">Select a view, or create a new one.</p>
            <NewViewButton canShare={canShare} />
          </div>
        </Surface>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {/* A GET form: search is a query parameter like every other filter. */}
            <form action="/opportunities/my" className="min-w-[12rem] max-w-sm flex-1">
              {VIEW_KEYS.map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
              <input
                name="q"
                defaultValue={q}
                placeholder="Search by opportunity, company or contact"
                aria-label="Search opportunities"
                className="w-full rounded-md bg-card px-3 py-1.5 text-body outline-none ring-ring focus-visible:ring-2"
              />
            </form>
            <div className="ml-auto">
              <RendererSwitch
                options={[
                  { label: "Table", href: href({ as: null, page: null }), current: !board },
                  { label: "Board", href: href({ as: "board", page: null }), current: board },
                ]}
              />
            </div>
          </div>

          {tooBroad ? (
            <Surface>
              <p className="py-6 text-center text-body text-muted-foreground">
                Too broad to load. Add a filter, or sort by a date.
              </p>
            </Surface>
          ) : error || rows.length === 0 ? (
            <ListEmpty
              noun="opportunities"
              error={error}
              activeFilters={activeFilters}
              clearHref={href({ q: null, page: null })}
            />
          ) : board ? (
            <OpportunityBoard key={viewQuery.toString() + q} rows={rows} />
          ) : (
            <OpportunityTable key={viewQuery.toString() + q + page} rows={rows} columns={columns} />
          )}

          {!board && !error && (hasMore || page > 0) && (
            <nav aria-label="Pages" className="flex items-center justify-between text-body text-muted-foreground">
              <span className="tabular-nums">
                {(page * PAGE + 1).toLocaleString()}–{(page * PAGE + rows.length).toLocaleString()}
              </span>
              <div className="flex gap-3">
                {page > 0 && (
                  <Link href={href({ page: page === 1 ? null : String(page - 1) })} className="text-primary hover:underline">
                    Previous
                  </Link>
                )}
                {hasMore && (
                  <Link href={href({ page: String(page + 1) })} className="text-primary hover:underline">
                    Next
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
