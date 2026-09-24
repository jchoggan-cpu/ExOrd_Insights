import Link from "next/link";
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/types";
import type { SharedDraft } from "@/lib/content-drafts";
import { draftsForSelection, draftsMatchingType } from "@/lib/drafts-for-selection";

/**
 * "This has already been written" -- shown between choosing what to draft
 * and pressing Generate, which is the only moment the warning can save
 * anyone anything.
 *
 * Two strengths, because they mean different things. A draft of the SAME
 * content type about the same order is very likely a duplicate and is worth
 * interrupting for. Anything else about that order is context: useful to
 * read first, not a reason to stop.
 *
 * Rendered inside the drafter's client boundary, so no "use client" here.
 */
export function ExistingDraftsWarning({
  drafts,
  selectedIds,
  contentType,
}: {
  drafts: SharedDraft[];
  selectedIds: string[];
  contentType: ContentType;
}) {
  const sameType = draftsMatchingType(drafts, selectedIds, contentType);
  const related = draftsForSelection(drafts, selectedIds).filter(
    (draft) => draft.contentType !== contentType,
  );

  if (sameType.length === 0 && related.length === 0) return null;

  return (
    <section
      className={`rounded border px-3 py-2 text-sm ${
        sameType.length > 0 ? "border-danger/40 bg-danger/10" : "border-brand/30 bg-brand/10"
      }`}
    >
      {sameType.length > 0 && (
        <p className="font-medium text-foreground">
          {sameType.length} {CONTENT_TYPE_LABELS[contentType]}
          {sameType.length === 1 ? " has" : "s have"} already been written about{" "}
          {selectedIds.length === 1 ? "this order" : "these orders"}. Generating another will cost
          money and may duplicate work.
        </p>
      )}

      {sameType.length === 0 && related.length > 0 && (
        <p className="font-medium text-foreground">
          {related.length} other draft{related.length === 1 ? "" : "s"} already cover
          {related.length === 1 ? "s" : ""} {selectedIds.length === 1 ? "this order" : "these orders"}.
        </p>
      )}

      <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
        {[...sameType, ...related].slice(0, 5).map((draft) => (
          <li key={draft.id}>
            <span className="text-muted-foreground">
              {CONTENT_TYPE_LABELS[draft.contentType]} &middot;{" "}
              {new Date(draft.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </span>{" "}
            {draft.title ?? "Untitled draft"}
          </li>
        ))}
      </ul>

      <Link href="/drafts" className="mt-1 inline-block text-xs text-link hover:underline">
        Read them first in Shared Drafts
      </Link>
    </section>
  );
}
