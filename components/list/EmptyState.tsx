import Link from "next/link";
import { Surface } from "@/components/ui/surface";

/**
 * What a list shows when it has no rows.
 *
 * Three different situations, three different messages. Collapsing them into
 * one "No results" is the single most common way a working app gets reported
 * as broken — and the way a genuinely broken query goes unnoticed for a week,
 * because a failed fetch and an empty table look identical.
 *
 *   empty     nothing exists yet        → offer to create one
 *   filtered  the filter excluded it    → name the filter, offer to clear it
 *   failed    the query did not run     → say so, offer to retry
 */

type Props = {
  /** Plural, lower case: "clients", "opportunities". */
  noun: string;
  className?: string;
};

export function NothingYet({
  noun,
  createHref,
  createLabel,
  className,
}: Props & { createHref?: string; createLabel?: string }) {
  return (
    <Surface className={className}>
      <div className="py-6 text-center">
        <p className="text-body text-muted-foreground">No {noun} yet</p>
        {createHref && createLabel ? (
          <Link
            href={createHref}
            className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-body font-medium text-primary-foreground"
          >
            {createLabel}
          </Link>
        ) : null}
      </div>
    </Surface>
  );
}

export function NoMatches({
  noun,
  /** What is currently narrowing the list, in the words on screen. */
  activeFilters,
  clearHref,
  className,
}: Props & { activeFilters: string[]; clearHref: string }) {
  return (
    <Surface className={className}>
      <div className="py-6 text-center">
        <p className="text-body text-muted-foreground">
          No {noun} match{" "}
          {activeFilters.length > 0 ? (
            <span className="text-foreground">{activeFilters.join(", ")}</span>
          ) : (
            "these filters"
          )}
        </p>
        <Link
          href={clearHref}
          className="mt-3 inline-block rounded-md bg-card-hover px-3 py-1.5 text-body"
        >
          Clear filters
        </Link>
      </div>
    </Surface>
  );
}

export function LoadFailed({
  noun,
  /** The underlying message. Shown, not swallowed. */
  detail,
  className,
}: Props & { detail?: string }) {
  return (
    <Surface className={className}>
      <div className="py-6 text-center">
        <p className="text-body text-destructive">Couldn&apos;t load {noun}</p>
        {detail ? (
          <p className="mx-auto mt-1 max-w-prose text-meta text-muted-foreground">{detail}</p>
        ) : null}
        {/*
          A plain link to the same URL rather than a router refresh: it works
          without JavaScript, and a failure that only a client component can
          recover from is a failure people get stuck in.
        */}
        <Link
          href=""
          className="mt-3 inline-block rounded-md bg-card-hover px-3 py-1.5 text-body"
        >
          Try again
        </Link>
      </div>
    </Surface>
  );
}

/**
 * Picks the right one. Most lists should call this rather than choosing.
 *
 * `error` wins over emptiness deliberately: if the query failed we do not know
 * whether the list is empty, and guessing "no results" turns a fault into a
 * fact.
 */
export function ListEmpty({
  noun,
  error,
  activeFilters,
  clearHref,
  createHref,
  createLabel,
  className,
}: Props & {
  error?: string | null;
  activeFilters?: string[];
  clearHref?: string;
  createHref?: string;
  createLabel?: string;
}) {
  if (error) return <LoadFailed noun={noun} detail={error} className={className} />;
  if (activeFilters && activeFilters.length > 0 && clearHref) {
    return (
      <NoMatches
        noun={noun}
        activeFilters={activeFilters}
        clearHref={clearHref}
        className={className}
      />
    );
  }
  return (
    <NothingYet
      noun={noun}
      createHref={createHref}
      createLabel={createLabel}
      className={className}
    />
  );
}
