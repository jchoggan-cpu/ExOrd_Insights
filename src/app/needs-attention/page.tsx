import Link from "next/link";
import { getFlaggedExecutiveOrders, getRecentIngestionRuns } from "@/lib/data";
import { NeedsReviewBadge } from "@/components/needs-review-badge";

// Reads live ingestion state (flags, run history) — must never be
// statically prerendered, or new flags/runs wouldn't show up without a
// rebuild (same reasoning as src/app/page.tsx, see README "Next steps").
export const dynamic = "force-dynamic";

const RUN_STATUS_STYLES: Record<string, string> = {
  success: "text-primary",
  running: "text-muted-foreground",
  partial: "text-danger",
  failure: "text-danger",
};

/**
 * Both reads throw on a failed query rather than degrading into stale or
 * empty data, so this page settles them independently instead of letting
 * either take the whole page down.
 *
 * That matters more here than anywhere else in the app. This is the only
 * surface that shows whether the pipeline is alive, so the moment one of
 * these two queries breaks is exactly the moment somebody needs the other
 * one — and the error boundary links here precisely because a database
 * problem is what sent them looking. A page that dies wholesale would make
 * the run history unreachable whenever it was most worth reading, and would
 * make the boundary's own recovery link a closed loop.
 */
/**
 * Stands in for one section whose query failed, so the other half of the
 * page still renders. Says "could not be loaded", never "nothing found" —
 * an empty list and an unreadable list mean opposite things here.
 */
function SectionUnavailable({ what }: { what: string }) {
  return (
    <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
      Could not load {what} — the database did not answer. The rest of this page is unaffected.
    </p>
  );
}

export default async function NeedsAttentionPage() {
  const [flaggedResult, runsResult] = await Promise.allSettled([
    getFlaggedExecutiveOrders(),
    getRecentIngestionRuns(),
  ]);

  const flaggedOrders = flaggedResult.status === "fulfilled" ? flaggedResult.value : null;
  const recentRuns = runsResult.status === "fulfilled" ? runsResult.value : null;

  if (flaggedResult.status === "rejected") console.error("Flagged orders unavailable:", flaggedResult.reason);
  if (runsResult.status === "rejected") console.error("Run history unavailable:", runsResult.reason);

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[120rem] flex-1 px-4 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-foreground">Needs Attention</h1>
          <p className="mt-1 text-muted-foreground">
            Rows flagged for human review, and recent Federal Register ingestion runs. Nothing here
            is automatic — this is what to check.
          </p>
        </div>

        <section className="mb-10">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Flagged orders{flaggedOrders ? ` (${flaggedOrders.length})` : ""}
          </h2>
          {flaggedOrders === null ? (
            <SectionUnavailable what="flagged orders" />
          ) : flaggedOrders.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing flagged right now.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
              {flaggedOrders.map((eo) => (
                <div
                  key={eo.id}
                  className="flex flex-col gap-1.5 border-b border-border/60 px-4 py-3 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Link href={`/eo/${eo.id}`} className="font-medium text-foreground hover:text-link">
                      {eo.eoNumber ?? eo.actionType ?? "—"} — {eo.title}
                    </Link>
                    <NeedsReviewBadge reason={eo.needsReviewReason ?? eo.ingestionFlagReason} />
                  </div>
                  <p className="text-xs text-muted-foreground">{eo.needsReviewReason ?? eo.ingestionFlagReason}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">Recent ingestion runs</h2>
          {recentRuns === null ? (
            <SectionUnavailable what="the run history" />
          ) : recentRuns.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No runs logged yet — either Supabase isn&apos;t connected, or nothing has run.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Started</th>
                    <th className="px-4 py-2 font-medium">New / Updated</th>
                    <th className="px-4 py-2 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{run.runType}</td>
                      <td className={`px-4 py-2 font-medium ${RUN_STATUS_STYLES[run.status] ?? ""}`}>
                        {run.status}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        {run.newCount} / {run.updatedCount}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 text-xs text-danger" title={run.errorMessage ?? ""}>
                        {run.errorMessage ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
