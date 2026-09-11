"use client";

import { useEffect } from "react";

/*
 * One level above the dashboard, because an error.tsx never catches errors from
 * the layout beside it -- only from that layout's children. The profile read
 * that decides whether you are signed in runs in (dashboard)/layout.tsx, so
 * without this file a failure there skipped straight past the dashboard's own
 * boundary to Next's bare default.
 *
 * The app had no error boundary at all, so anything thrown in a page or the
 * dashboard layout fell through to Next's bare default.
 *
 * This matters more than it looks. Reads used to swallow their errors and
 * return nothing, which rendered as "no data" or, worse, as "not a Factur
 * account". They are being changed to throw instead -- and a throw needs
 * somewhere honest to land, or the fix just trades a misleading message for
 * a blank one.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-section">
      <div className="max-w-md rounded-md bg-card p-card text-center">
        {/* design-ok: a centred error message, not a page header */}
        <h1 className="text-2xl font-semibold">This page couldn&apos;t load</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Usually a slow moment on the database. Trying again normally works.
        </p>
        {/* The real message, so a report says what failed rather than that
            something did. The digest ties it to the server log. */}
        <p className="mt-3 break-words text-meta text-muted-foreground">
          {error.message}
          {error.digest ? ` · ${error.digest}` : ""}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
