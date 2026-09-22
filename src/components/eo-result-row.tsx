import Link from "next/link";
import type { ExecutiveOrderListItem } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { TagPill } from "@/components/tag-pill";
import { NeedsReviewBadge } from "@/components/needs-review-badge";
import { PriorAdministrationBadge } from "@/components/prior-administration-badge";
import { EoSelectCheckbox } from "@/components/eo-select-checkbox";
import { parseSnippet } from "@/lib/highlight-snippet";
import { tagFilterHref } from "@/lib/tag-filter-link";
import type { TrackerQuery } from "@/lib/tracker-query";
import { formatDate } from "@/lib/format-date";
import { isPriorAdministrationHoldover } from "@/lib/federal-register/prior-administration";

/**
 * One order in the results list.
 *
 * Deliberately not a table row. The table this replaced gave the title 248px
 * at 1440 and the two tag columns 685px between them, so titles wrapped to
 * six lines, four orders fitted on screen and the Legal Challenges column
 * sat 136px off the right edge behind a horizontal scrollbar. A row that
 * stacks instead of columnising gives the title the width, and has nothing
 * to scroll sideways.
 *
 * What goes where follows what the data can actually support: subject_area
 * is on 100% of rows and practice_areas on 77%, so both are pills; industry
 * is missing from 44% and is demoted to the grey line, where a blank reads
 * as "not tagged" rather than as a hole in the layout.
 *
 * Presentational and server-rendered -- no state, no JavaScript shipped.
 */
export function EoResultRow({
  order,
  query,
}: {
  order: ExecutiveOrderListItem;
  /** What is filtered now, so a tag can link to "just this tag" and offer a way back. */
  query: TrackerQuery;
}) {
  const challengeCount = order.legalChallenges.length;
  // Present only on a search, and only when the match was in the body --
  // see migration 0009. Otherwise the summary is what the row shows.
  const snippetSegments = parseSnippet(order.snippet);

  return (
    <li className="border-b border-border last:border-0">
      <div className="flex flex-col gap-2.5 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:gap-4 sm:px-5">
        <EoSelectCheckbox id={order.id} title={order.title} />

        {/* Identity rail. Inline above the title on a phone, a column beside
            it from `sm` up. */}
        <div className="flex shrink-0 items-baseline gap-2 text-xs text-muted-foreground sm:w-28 sm:flex-col sm:items-start sm:gap-1">
          <span className="font-mono font-medium text-foreground">
            {order.eoNumber ?? order.actionType ?? "—"}
          </span>
          {order.eoNumber && order.actionType && (
            <span className="hidden sm:inline">{order.actionType}</span>
          )}
          <span className="sm:mt-0.5">{formatDate(order.dateSigned)}</span>
        </div>

        {/* The main event. min-w-0 lets long titles wrap instead of forcing
            the row wider than its container. */}
        <div className="min-w-0 flex-1">
          <Link
            href={`/eo/${order.id}`}
            className="font-display text-base font-semibold text-link hover:underline sm:text-lg"
          >
            {order.title}
          </Link>

          {snippetSegments.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
              {snippetSegments.map((segment, index) =>
                segment.highlighted ? (
                  <mark
                    key={index}
                    className="rounded-sm bg-brand/25 px-0.5 text-foreground"
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </p>
          ) : (
            order.aiSummary && (
              <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
                {order.aiSummary}
              </p>
            )
          )}

          {(order.subjectArea.length > 0 || order.practiceAreas.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {order.subjectArea.map((subject) => (
                <TagPill
                  key={subject}
                  label={subject}
                  kind="subject"
                  href={tagFilterHref(query, "subject", subject)}
                />
              ))}
              {order.practiceAreas.map((area) => (
                <TagPill
                  key={area}
                  label={area}
                  kind="practice"
                  href={tagFilterHref(query, "practice", area)}
                />
              ))}
            </div>
          )}

          {order.industries.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Clients in {order.industries.join(" · ")}
            </p>
          )}

          {(order.needsReview || isPriorAdministrationHoldover(order.dateSigned)) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {order.needsReview && <NeedsReviewBadge reason={order.needsReviewReason} />}
              {isPriorAdministrationHoldover(order.dateSigned) && (
                <PriorAdministrationBadge dateSigned={order.dateSigned} />
              )}
            </div>
          )}
        </div>

        {/* Status rail. */}
        <div className="flex shrink-0 items-center gap-3 sm:w-40 sm:flex-col sm:items-end sm:gap-1.5">
          <StatusBadge status={order.status} />
          <span className="text-xs text-muted-foreground sm:text-right">
            {challengeCount === 0
              ? "No legal challenges"
              : `${challengeCount} legal challenge${challengeCount === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>
    </li>
  );
}
