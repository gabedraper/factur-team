"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { hideView, pinView } from "@/actions/list-views";
import type { ResolvedView } from "@/lib/list-views/catalogue";

/**
 * The row of views at the top of every list.
 *
 * Chips are **links**, not buttons. A view is a set of query parameters, so
 * switching to one is a navigation: the URL changes, the back button undoes
 * it, and the address bar holds exactly what somebody would paste to a
 * colleague. A button setting state would look identical and do none of that.
 *
 * Only pinned views are chips. There are 215 live clients, and a row of 215
 * would bury the two views a person opens every day, so the rest live behind
 * a search.
 */

/** The query parameters that mean "a view is selected". */
const VIEW_PARAMS = ["scope", "client", "view"] as const;

export function ViewSwitcher({
  entity,
  pinned,
  rest,
  canSave,
  onSave,
}: {
  entity: string;
  pinned: ResolvedView[];
  rest: ResolvedView[];
  canSave?: boolean;
  onSave?: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const href = (view: ResolvedView) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(view.params)) next.set(k, v);
    return `${pathname}?${next.toString()}`;
  };

  /* A chip is current when every parameter it sets is already set. Comparing
     whole query strings would drop the highlight the moment somebody sorted a
     column, which is exactly when they still want to know where they are. */
  const isCurrent = (view: ResolvedView) => {
    const entries = Object.entries(view.params);
    /* The "All" view sets nothing, and [].every() is true -- so without this
       it would be highlighted as current on every page, including while
       "My clients" is showing. It is current only when no view is selected. */
    if (entries.length === 0) return !VIEW_PARAMS.some((k) => params.has(k));
    return entries.every(([k, v]) => params.get(k) === v);
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rest;
    return rest.filter((v) => v.label.toLowerCase().includes(q));
  }, [rest, query]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pinned.map((v) => (
        <ChipLink key={v.key} view={v} href={href(v)} current={isCurrent(v)} entity={entity} />
      ))}

      {rest.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            aria-expanded={picking}
            className="rounded-full bg-card px-3 py-1 text-meta text-muted-foreground transition-colors duration-fast ease-out hover:bg-card-hover hover:text-foreground"
          >
            More… <span className="tabular-nums">{rest.length}</span>
          </button>

          {picking && (
            <>
              {/* Click-away. A transparent sheet rather than a document
                  listener, so it cannot outlive the component. */}
              <button
                type="button"
                aria-label="Close"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setPicking(false)}
              />
              <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md bg-popover p-2 shadow-overlay">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a view"
                  className="mb-2 w-full rounded-sm bg-field px-2 py-1.5 text-body outline-none ring-ring focus-visible:ring-2"
                />
                <div className="max-h-72 overflow-y-auto">
                  {matches.length === 0 ? (
                    <p className="px-2 py-3 text-meta text-muted-foreground">
                      Nothing matches “{query}”.
                    </p>
                  ) : (
                    matches.map((v) => (
                      <div key={v.key} className="group flex items-center gap-1">
                        <Link
                          href={href(v)}
                          onClick={() => setPicking(false)}
                          className="flex-1 truncate rounded-sm px-2 py-1.5 text-body hover:bg-card-hover"
                        >
                          {v.label}
                        </Link>
                        <button
                          type="button"
                          title={`Pin ${v.label}`}
                          onClick={() => pinView(entity, v.key, true)}
                          className="rounded-sm px-2 py-1 text-meta text-muted-foreground opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                        >
                          Pin
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {canSave && (
        <button
          type="button"
          onClick={onSave}
          className="rounded-full px-3 py-1 text-meta text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
        >
          + Save view
        </button>
      )}
    </div>
  );
}

function ChipLink({
  view,
  href,
  current,
  entity,
}: {
  view: ResolvedView;
  href: string;
  current: boolean;
  entity: string;
}) {
  return (
    <span className="group relative inline-flex">
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={cn(
          "max-w-[14rem] truncate rounded-full px-3 py-1 text-meta transition-colors duration-fast ease-out",
          current
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground hover:bg-card-hover hover:text-foreground",
        )}
      >
        {view.label}
      </Link>
      {/* Hiding a chip is available on every kind of view, including the ones
          defined in code -- somebody who never looks at their team's work
          should not have to keep seeing it. */}
      <button
        type="button"
        title={`Hide ${view.label}`}
        onClick={() => hideView(entity, view.key, true)}
        className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-popover text-meta leading-none text-muted-foreground shadow-overlay group-hover:flex focus-visible:flex hover:text-foreground"
      >
        ×
      </button>
    </span>
  );
}
