import type { SummaryDraft } from "@/lib/summary-drafts";
import { formatDeliverables } from "@/lib/federal-register/format-deliverables";
import { TagPill } from "@/components/tag-pill";
import { formatDate } from "@/lib/format-date";

/**
 * Shows an AI draft next to the summary already on the order.
 *
 * Deliberately reads as a proposal, not a result: the curated summary above
 * it stays the order's summary until a person decides otherwise. Promotion
 * is manual and out of the app for now — copy the text up, or leave it.
 */
export function SummaryDraftPanel({ draft, hasCuratedSummary }: { draft: SummaryDraft; hasCuratedSummary: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {hasCuratedSummary ? "AI draft (not in use)" : "AI draft"}
        </h3>
        <span className="text-xs text-muted-foreground">
          {draft.model} · {formatDate(draft.createdAt)}
        </span>
      </div>

      {draft.unverifiedQuotes.length > 0 && (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
          <p className="text-xs font-medium text-danger">
            Contains quoted text not found verbatim in this order&apos;s full text — treat as
            fabricated until checked:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-danger">
            {draft.unverifiedQuotes.map((quote) => (
              <li key={quote}>&ldquo;{quote}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-sm leading-relaxed text-foreground/90">{draft.summary}</p>

      {draft.deliverables !== null && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">Deliverables</p>
          <p className="mt-1 whitespace-pre-line text-sm text-foreground/90">
            {formatDeliverables(draft.deliverables)}
          </p>
        </div>
      )}

      {(draft.subjectArea.length > 0 || draft.practiceAreas.length > 0 || draft.industries.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {draft.subjectArea.map((tag) => (
            <TagPill key={`subject-${tag}`} label={tag} kind="subject" />
          ))}
          {draft.practiceAreas.map((tag) => (
            <TagPill key={`practice-${tag}`} label={tag} kind="practice" />
          ))}
          {draft.industries.map((tag) => (
            <TagPill key={`industry-${tag}`} label={tag} kind="industry" />
          ))}
        </div>
      )}
    </div>
  );
}
