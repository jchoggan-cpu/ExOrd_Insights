"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import Link from "next/link";

/**
 * Shown when a page throws — in practice, almost always because a Supabase
 * read failed. The data layer deliberately throws rather than falling back
 * to the imported January spreadsheet, so a reader can never be shown stale
 * text that looks live; this is what they see instead.
 *
 * It says "cannot reach", not "something went wrong", because the two lead
 * to different actions: nothing here is worth retyping or re-drafting, and
 * the tracker's data is not lost. It also does not invite the reader to go
 * fix anything — /needs-attention is linked because a Supabase outage is
 * exactly what the watchdog reports, so the run history there is the useful
 * next thing to look at once the database answers again.
 *
 * `retry` (not `reset`) is the prop in Next 16.3 — it re-fetches and
 * re-renders the segment, which is the right behaviour for a transient
 * database failure. `reset` only clears the error state without re-fetching.
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Nothing aggregates client-side errors yet, so the browser console is
    // where this lives. The server-side console.error in the data layer is
    // the one Vercel captures.
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-16">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Can&apos;t reach the tracker&apos;s database
        </h1>
        <p className="mt-3 text-muted-foreground">
          This page needs live data and the database did not answer, so nothing is shown rather
          than showing you figures that might be out of date. No tracker data has been lost.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface/80"
          >
            Try again
          </button>
          <Link href="/needs-attention" className="text-sm text-link hover:underline">
            Recent ingestion runs
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-8 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
