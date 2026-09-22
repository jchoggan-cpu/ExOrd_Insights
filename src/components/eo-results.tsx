import type { ExecutiveOrderListItem } from "@/lib/types";
import { EoResultRow } from "@/components/eo-result-row";
import type { TrackerQuery } from "@/lib/tracker-query";

/**
 * Renders one page of tracker results.
 *
 * Purely presentational, and deliberately NOT a client component:
 * searching, filtering and paging happen in Postgres (see
 * executive-orders-search.ts), so this needs no state and its markup never
 * ships to the browser as JavaScript.
 *
 * A list rather than a table since the row redesign -- see eo-result-row.tsx
 * for why.
 */
export function EoResults({
  orders,
  query,
}: {
  orders: ExecutiveOrderListItem[];
  query: TrackerQuery;
}) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-muted-foreground">
        No executive orders match your search or filters.
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-border bg-surface">
      {orders.map((order) => (
        <EoResultRow key={order.id} order={order} query={query} />
      ))}
    </ul>
  );
}
