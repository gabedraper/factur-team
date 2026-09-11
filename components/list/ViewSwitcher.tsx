"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { pinView } from "@/actions/list-views";
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
 * a search. Pinning and unpinning both happen there.
 *
 * The × on the selected chip clears the selection -- it does not remove the
 * view. It used to hide the view, and people pressed it expecting to be back
 * at "nothing selected"; instead the chip vanished for good, with no way to
 * get it back, and the list underneath went on showing its rows. It is only
 * offered where the page has a "nothing selected" state to go to (clearHref).
 */

/** The query parameters that mean "a view is selected". */
const VIEW_PARAMS = ["scope", "client", "view"] as const;
/** Parameters carried across a view switch rather than reset by it. */
const KEEP_PARAMS = ["as"] as const;

export function ViewSwitcher({
  entity,
  pinned,
  rest,
  canSave,
  onSave,
  clearHref,
}: {
  entity: string;
  pinned: ResolvedView[];
  rest: ResolvedView[];
  canSave?: boolean;
  onSave?: () => void;
  /** Where the selected chip's × goes: this list with no view selected. */
  clearHref?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const href = (view: ResolvedView) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(view.params)) next.set(k, v);
    // Table or board is how you are looking, not what -- it survives a switch.
    for (const k of KEEP_PARAMS) {
      const v = params.get(k);
      if (v) next.set(k, v);
    }
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
    const all = [
      ...pinned.map((view) => ({ view, pinned: true })),
      ...rest.map((view) => ({ view, pinned: false })),
    ];
    if (!q) return all;
    return all.filter(({ view }) => view.label.toLowerCase().includes(q));
  }, [pinned, rest, query]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pinned.map((v) => (
        <ChipLink key={v.key} view={v} href={href(v)} current={isCurrent(v)} clearHref={clearHref} />
      ))}

      {(rest.length > 0 || pinned.length > 0) && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            aria-expanded={picking}
            className="rounded-full bg-card px-3 py-1 text-meta text-muted-foreground transition-colors duration-fast ease-out hover:bg-card-hover hover:text-foreground"
          >
            More…{rest.length > 0 && <span className="tabular-nums"> {rest.length}</span>}
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
                    matches.map(({ view: v, pinned: isPinned }) => (
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
                          title={`${isPinned ? "Unpin" : "Pin"} ${v.label}`}
                          onClick={() => pinView(entity, v.key, !isPinned)}
                          className="rounded-sm px-2 py-1 text-meta text-muted-foreground opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                        >
                          {isPinned ? "Unpin" : "Pin"}
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
  clearHref,
}: {
  view: ResolvedView;
  href: string;
  current: boolean;
  clearHref?: string;
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
      {current && clearHref && (
        <Link
          href={clearHref}
          title={`Clear ${view.label}`}
          aria-label={`Clear ${view.label}`}
          className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-popover text-meta leading-none text-muted-foreground shadow-overlay group-hover:flex focus-visible:flex hover:text-foreground"
        >
          ×
        </Link>
      )}
    </span>
  );
}
