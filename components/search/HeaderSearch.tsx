"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchRecords } from "@/actions/search";
import {
  SEARCH_OBJECTS, OBJECT_LABEL, defaultScopeFor, hrefFor, isSearchObject,
  type SearchGroup, type SearchObject, type SearchScope,
} from "@/lib/search/objects";

/*
 * The search in the top bar. An object picker, then the box -- Salesforce's
 * shape, because that is where the people moving off Salesforce will reach.
 *
 * Results drop down as you type, five per object on All and ten on one object.
 * Enter with nothing highlighted opens the full results page, which is also
 * where the dropdown's last row goes. ⌘K or / from anywhere puts the cursor in
 * the box.
 *
 * The picker follows the page: on Opportunities it starts on Opportunities,
 * elsewhere on All. On the results page it follows the URL instead, so the box
 * shows the search you are looking at.
 */

const DEBOUNCE_MS = 180;

export function HeaderSearch({ allowed }: { allowed: SearchObject[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const onResultsPage = pathname === "/search";

  const [scope, setScope] = useState<SearchScope>(() =>
    onResultsPage && isSearchObject(params.get("in")) ? (params.get("in") as SearchObject) : defaultScopeFor(pathname, allowed),
  );
  const [q, setQ] = useState(() => (onResultsPage ? params.get("q") ?? "" : ""));
  const [groups, setGroups] = useState<SearchGroup[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  /* A new page resets the picker to that page's object. */
  useEffect(() => {
    if (onResultsPage) {
      const inParam = params.get("in");
      setScope(isSearchObject(inParam) ? inParam : "all");
      setQ(params.get("q") ?? "");
    } else {
      setScope(defaultScopeFor(pathname, allowed));
    }
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, onResultsPage ? params.toString() : ""]);

  /* Debounced, and only the latest answer is kept -- a slow reply to "jo"
     must not land on top of the reply to "john". */
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setGroups(null);
      setLoading(false);
      return;
    }
    const id = ++requestRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchRecords({ q: term, scope, limit: scope === "all" ? 5 : 10 });
        if (id !== requestRef.current) return;
        setGroups(res);
        setActive(-1);
      } catch {
        if (id !== requestRef.current) return;
        setGroups([]);
      } finally {
        if (id === requestRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, scope]);

  /* ⌘K / Ctrl+K anywhere, and / when you are not already typing somewhere. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Closes on a click anywhere else. A listener rather than a click-away
     sheet: a sheet would sit over the page and eat the click. */
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const flat = useMemo(
    () => (groups ?? []).flatMap((g) => g.hits.map((h) => ({ hit: h, href: hrefFor(h) }))),
    [groups],
  );

  const allHref = () => {
    const next = new URLSearchParams({ q: q.trim() });
    if (scope !== "all") next.set("in", scope);
    return `/search?${next.toString()}`;
  };

  const go = (href: string) => {
    setOpen(false);
    inputRef.current?.blur();
    router.push(href);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (q.trim().length < 2) return;
      go(active >= 0 && flat[active] ? flat[active].href : allHref());
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const options = SEARCH_OBJECTS.filter((o) => allowed.includes(o.key));
  const showPanel = open && q.trim().length >= 2 && groups !== null;
  const anyHits = flat.length > 0;
  const failed = (groups ?? []).filter((g) => g.error);
  let index = -1;

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <div className="flex h-8 items-center rounded-md bg-field ring-ring focus-within:ring-2">
        <select
          aria-label="Search in"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as SearchScope);
            inputRef.current?.focus();
            setOpen(true);
          }}
          className="h-full max-w-[10rem] shrink-0 cursor-pointer rounded-l-md border-r border-border bg-transparent pl-2 pr-1 text-meta text-muted-foreground outline-none hover:text-foreground"
        >
          <option value="all">All</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="header-search-results"
          aria-label="Search records"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={scope === "all" ? "Search" : `Search ${OBJECT_LABEL[scope].toLowerCase()}`}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-body outline-none placeholder:text-muted-foreground"
        />
        <kbd className="mr-2 hidden shrink-0 rounded-sm bg-card px-1.5 text-meta text-muted-foreground md:inline">⌘K</kbd>
      </div>

      {showPanel && (
        <div
          id="header-search-results"
          role="listbox"
          aria-busy={loading}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-md bg-popover p-1 shadow-overlay"
        >
          {failed.map((g) => (
            <p key={g.object} className="px-2 py-1.5 text-meta text-destructive">{g.error}</p>
          ))}

          {!anyHits && failed.length === 0 && (
            <p className="px-2 py-3 text-body text-muted-foreground">
              {loading ? "Searching…" : `Nothing matches “${q.trim()}”.`}
            </p>
          )}

          {(groups ?? []).filter((g) => g.hits.length > 0).map((g) => (
            <div key={g.object} className="py-1">
              <p className="px-2 pb-0.5 text-meta font-medium text-muted-foreground">{OBJECT_LABEL[g.object]}</p>
              {g.hits.map((h) => {
                index += 1;
                const i = index;
                return (
                  <Link
                    key={`${h.object}:${h.id}`}
                    href={hrefFor(h)}
                    role="option"
                    aria-selected={active === i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block rounded-sm px-2 py-1.5",
                      active === i ? "bg-card-hover" : "hover:bg-card-hover",
                    )}
                  >
                    <span className="block truncate text-body">{h.title || "Unnamed"}</span>
                    {h.subtitle && <span className="block truncate text-meta text-muted-foreground">{h.subtitle}</span>}
                  </Link>
                );
              })}
            </div>
          ))}

          {anyHits && (
            <Link
              href={allHref()}
              onClick={() => setOpen(false)}
              className="mt-1 block rounded-sm px-2 py-1.5 text-meta text-primary hover:bg-card-hover"
            >
              All results for “{q.trim()}”
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
