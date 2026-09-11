import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { searchRecords, searchableObjects } from "@/actions/search";
import { SEARCH_OBJECTS, OBJECT_LABEL, hrefFor, isSearchObject, type SearchScope } from "@/lib/search/objects";

export const dynamic = "force-dynamic";

/*
 * Everything the header search found, where the dropdown's "All results" row
 * and a bare Enter go. The search itself lives in the URL (?q=, ?in=), so a
 * results page reloads, goes back, and pastes into Slack like any list.
 *
 * All shows ten per object with a way into each; one object shows fifty.
 * Nothing here respects a view -- that is the point of it.
 */

type Search = { q?: string; in?: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const allowed = await searchableObjects();
  const scope: SearchScope = isSearchObject(sp.in) && allowed.includes(sp.in) ? sp.in : "all";
  const perObject = scope === "all" ? 10 : 50;
  const groups = q.length >= 2 ? await searchRecords({ q, scope, limit: perObject }) : [];

  const href = (s: SearchScope) => {
    const next = new URLSearchParams({ q });
    if (s !== "all") next.set("in", s);
    return `/search?${next.toString()}`;
  };

  const tabs: { key: SearchScope; label: string }[] = [
    { key: "all", label: "All" },
    ...SEARCH_OBJECTS.filter((o) => allowed.includes(o.key)).map((o) => ({ key: o.key, label: o.label })),
  ];
  const found = groups.filter((g) => g.hits.length > 0 || g.error);

  return (
    <div className="space-y-4 p-section">
      <PageHeader title={q ? `Results for “${q}”` : "Search"} />

      {q && (
        <nav aria-label="Search in" className="flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={scope === t.key ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1 text-meta transition-colors duration-fast ease-out",
                scope === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-card-hover hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {q.length < 2 ? (
        <Surface>
          <p className="py-6 text-center text-body text-muted-foreground">Type at least two letters in the search bar.</p>
        </Surface>
      ) : found.length === 0 ? (
        <Surface>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-body text-muted-foreground">
              Nothing in {scope === "all" ? "any records" : OBJECT_LABEL[scope].toLowerCase()} matches “{q}”.
            </p>
            {scope !== "all" && (
              <Link href={href("all")} className="text-body text-primary hover:underline">
                Search everything
              </Link>
            )}
          </div>
        </Surface>
      ) : (
        found.map((g) => (
          <section key={g.object} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-section-title">
                {OBJECT_LABEL[g.object]}{" "}
                <span className="text-meta font-normal tabular-nums text-muted-foreground">
                  {g.hits.length}{g.more ? "+" : ""}
                </span>
              </h2>
              {scope === "all" && g.more && (
                <Link href={href(g.object)} className="text-meta text-primary hover:underline">
                  All {OBJECT_LABEL[g.object].toLowerCase()}
                </Link>
              )}
            </div>
            <Surface pad="none">
              {g.error ? (
                <p className="p-card-tight text-body text-destructive">{g.error}</p>
              ) : (
                <ul className="[&>li:not(:last-child)]:border-b">
                  {g.hits.map((h) => (
                    <li key={h.id}>
                      <Link
                        href={hrefFor(h)}
                        className="block px-cell-x py-cell-y transition-colors duration-fast ease-out hover:bg-card-hover"
                      >
                        <span className="block truncate text-body">{h.title || "Unnamed"}</span>
                        {h.subtitle && (
                          <span className="block truncate text-meta text-muted-foreground">{h.subtitle}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Surface>
            {scope !== "all" && g.more && (
              <p className="text-meta text-muted-foreground">
                Showing the first {perObject}. Add another word to narrow it.
              </p>
            )}
          </section>
        ))
      )}
    </div>
  );
}
