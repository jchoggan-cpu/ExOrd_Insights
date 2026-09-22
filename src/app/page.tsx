import { isUsingLocalData } from "@/lib/data";
import { searchExecutiveOrders } from "@/lib/executive-orders-search";
import { parseTrackerQuery, type RawSearchParams } from "@/lib/tracker-query";
import { EoResults } from "@/components/eo-results";
import { TrackerControls } from "@/components/tracker-controls";
import { TrackerPagination } from "@/components/tracker-pagination";
import { LocalDataBanner } from "@/components/local-data-banner";
import { EoSelectionBar } from "@/components/eo-selection-bar";

// Reads live tracker data (cron jobs ingest new orders continuously) — must
// never be statically prerendered, or new/updated orders wouldn't show up
// without a redeploy. Next's legacy caching model defaults a page like this
// ("looks static — just reads and renders") to prerender-and-cache-forever,
// which is exactly the wrong default for a tracker whose whole value is
// currency. Same reasoning as src/app/needs-attention/page.tsx.
export const dynamic = "force-dynamic";

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // Search, filters, sort and page all live in the URL, so a filtered view
  // can be shared, bookmarked and reached with the back button — and so the
  // server can do the work rather than shipping every row to the browser.
  const query = parseTrackerQuery(await searchParams);
  const { rows, total, page, totalPages } = await searchExecutiveOrders(query);
  const usingLocalData = isUsingLocalData();

  return (
    <main className="flex flex-1 flex-col">
      {usingLocalData && <LocalDataBanner />}
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-foreground">
            Executive Order Tracker
          </h1>
          <p className="mt-1 text-muted-foreground">
            Executive orders from the current administration (Jan 20, 2025 onward), with
            AI-assisted summaries, tagging, and litigation tracking.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <TrackerControls query={query} total={total} />
          <EoResults orders={rows} />
          <TrackerPagination query={query} page={page} totalPages={totalPages} />
        </div>

        {/* Reads the same store as the rows' checkboxes, backed by
            sessionStorage so a selection survives paging. */}
        <EoSelectionBar />
      </div>
    </main>
  );
}
