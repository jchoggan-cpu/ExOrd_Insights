import { getExecutiveOrders, isUsingLocalData } from "@/lib/data";
import { EoTable } from "@/components/eo-table";
import { LocalDataBanner } from "@/components/local-data-banner";

// Reads live tracker data (cron jobs ingest new orders continuously) — must
// never be statically prerendered, or new/updated orders wouldn't show up
// without a redeploy. Next's legacy caching model defaults a page like this
// ("looks static — just reads and renders") to prerender-and-cache-forever,
// which is exactly the wrong default for a tracker whose whole value is
// currency. Same reasoning as src/app/needs-attention/page.tsx.
export const dynamic = "force-dynamic";

export default async function TrackerPage() {
  const orders = await getExecutiveOrders();
  const usingLocalData = isUsingLocalData();

  return (
    <main className="flex flex-1 flex-col">
      {usingLocalData && <LocalDataBanner />}
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-foreground">
            Executive Order Tracker
          </h1>
          <p className="mt-1 text-muted">
            Executive orders from the current administration (Jan 20, 2025 onward), with
            AI-assisted summaries, tagging, and litigation tracking.
          </p>
        </div>
        <EoTable orders={orders} />
      </div>
    </main>
  );
}
