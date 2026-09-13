import Link from "next/link";
import type { ExecutiveOrderListItem } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { TagPill } from "@/components/tag-pill";
import { NeedsReviewBadge } from "@/components/needs-review-badge";
import { PriorAdministrationBadge } from "@/components/prior-administration-badge";
import { formatDate } from "@/lib/format-date";
import { isPriorAdministrationHoldover } from "@/lib/federal-register/prior-administration";

/**
 * Renders one page of tracker rows.
 *
 * Purely presentational, and deliberately NOT a client component any more:
 * searching, filtering and paging moved to Postgres (see
 * executive-orders-search.ts), so this no longer needs state and its markup
 * no longer ships to the browser as JavaScript.
 */
export function EoTable({ orders }: { orders: ExecutiveOrderListItem[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-background/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">EO Number</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Date Signed</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Practice Areas</th>
              <th className="px-4 py-3 font-medium">Industries</th>
              <th className="px-4 py-3 font-medium">Legal Challenges</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((eo) => (
              <tr key={eo.id} className="border-b border-border last:border-0 hover:bg-background/50">
                <td className="px-4 py-3 align-top font-mono text-xs text-muted">
                  {eo.eoNumber ?? eo.actionType ?? "—"}
                </td>
                <td className="px-4 py-3 align-top">
                  <Link href={`/eo/${eo.id}`} className="font-medium text-link hover:underline">
                    {eo.title}
                  </Link>
                  {eo.needsReview && (
                    <div className="mt-1">
                      <NeedsReviewBadge reason={eo.needsReviewReason} />
                    </div>
                  )}
                  {isPriorAdministrationHoldover(eo.dateSigned) && (
                    <div className="mt-1">
                      <PriorAdministrationBadge dateSigned={eo.dateSigned} />
                    </div>
                  )}
                  {eo.subjectArea.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {eo.subjectArea.map((s) => (
                        <TagPill key={s} label={s} kind="subject" />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top whitespace-nowrap text-muted">
                  {formatDate(eo.dateSigned)}
                </td>
                <td className="px-4 py-3 align-top">
                  <StatusBadge status={eo.status} />
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {eo.practiceAreas.map((p) => (
                      <TagPill key={p} label={p} kind="practice" />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {eo.industries.map((i) => (
                      <TagPill key={i} label={i} kind="industry" />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-muted">
                  {eo.legalChallenges.length > 0 ? eo.legalChallenges.length : "—"}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No executive orders match your search or filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
