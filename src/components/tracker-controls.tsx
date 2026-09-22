"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TrackerFilterBar } from "@/components/tracker-filter-bar";
import { TrackerSearchField } from "@/components/tracker-search-field";
import { TrackerResultBar } from "@/components/tracker-result-bar";
import { buildTrackerQueryString, withTrackerChange, type TrackerQuery } from "@/lib/tracker-query";

/**
 * Owns the tracker's interactive state: the debounced search box, and
 * turning any change into a new URL.
 *
 * The only client component on the page -- the results themselves are
 * rendered on the server, so 557 rows of markup never ship as JavaScript.
 * Layout lives in tracker-filter-bar.tsx and tracker-result-bar.tsx, which
 * render inside this boundary.
 *
 * Current state arrives as a prop rather than from useSearchParams(), which
 * keeps this out of a Suspense boundary and keeps the server as the single
 * source of truth for what is being shown.
 */

/**
 * How long to wait after the last keystroke before searching. Each search is
 * a database round trip, so firing per character would issue a dozen queries
 * for one word and race their responses. 300ms is below the threshold where
 * typing feels laggy and above the gap between keystrokes.
 */
const SEARCH_DEBOUNCE_MS = 300;

export function TrackerControls({
  query,
  total,
  undoFilters,
  children,
}: {
  query: TrackerQuery;
  total: number;
  /** The previous query string, when a tag click replaced the filters. */
  undoFilters?: string;
  /** The results and their paging, rendered on the server and placed in the results column. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [searchText, setSearchText] = useState(query.search);
  // Tracks whether the pending change came from this component, so the sync
  // below doesn't fight the user mid-keystroke.
  const isTypingRef = useRef(false);

  function navigate(change: Partial<TrackerQuery>) {
    const next = withTrackerChange(query, change);
    const qs = buildTrackerQueryString(next);
    // replace, not push: typing a search shouldn't bury the previous page in
    // history so the back button has to be pressed once per character.
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  // Debounce the search box. Everything else navigates immediately -- a
  // dropdown is one deliberate choice, not a stream of them.
  useEffect(() => {
    if (searchText === query.search) return;
    isTypingRef.current = true;
    const timer = setTimeout(() => {
      navigate({ search: searchText });
      isTypingRef.current = false;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Keep the box in step when the URL changes from outside -- the back
  // button, or a shared link -- but never while someone is mid-word.
  useEffect(() => {
    if (!isTypingRef.current) setSearchText(query.search);
  }, [query.search]);

  // Two columns from `lg` up: filters at the left, everything else beside
  // them. The results are passed in as children so they stay server-rendered
  // -- putting them inside this client component's tree does not make them
  // client components.
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
      <aside className="lg:w-48 lg:shrink-0">
        <TrackerFilterBar query={query} onChange={navigate} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <TrackerSearchField searchText={searchText} onSearchTextChange={setSearchText} />
        <TrackerResultBar
          query={query}
          total={total}
          undoFilters={undoFilters}
          onChange={navigate}
        />
        {children}
      </div>
    </div>
  );
}
