"use client";

import Link from "next/link";
import { useState } from "react";
import { CONTENT_TYPE_LABELS } from "@/lib/types";
import type { SharedDraft } from "@/lib/content-drafts";
import { useSessionDrafts } from "@/components/use-session-drafts";
import type { OrderLabel } from "@/lib/order-labels";

/**
 * One shared draft in the list, collapsed to its opening until expanded.
 *
 * Delete appears for two kinds of reader and nobody else: the session that
 * created this draft, which still holds its token, and an admin, whose token
 * was minted server-side on a page only they can open. Everyone else can
 * read and reuse, which is the point of the list.
 */
const PREVIEW_CHARS = 320;

export function DraftListItem({
  draft,
  orderLabels,
  adminDeleteToken,
}: {
  draft: SharedDraft;
  /** The orders this draft covers, by name rather than by count. */
  orderLabels: OrderLabel[];
  adminDeleteToken: string | null;
}) {
  const { forget, tokenFor } = useSessionDrafts();
  const [expanded, setExpanded] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The session's own token first: it means "I made this", which is the
  // case the delete control was asked for.
  const deleteToken = tokenFor(draft.id) ?? adminDeleteToken;
  const isMine = tokenFor(draft.id) !== null;

  if (deleted) return null;

  const signedAt = new Date(draft.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  async function handleDelete() {
    if (!deleteToken) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/content-drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, deleteToken }),
      });
      if (!res.ok) throw new Error("Delete failed");
      forget(draft.id);
      setDeleted(true);
    } catch {
      setError("Could not delete that draft.");
      setDeleting(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-base font-semibold text-foreground">
          {draft.title ?? "Untitled draft"}
        </span>
        <span className="text-xs text-muted-foreground">
          {CONTENT_TYPE_LABELS[draft.contentType]} &middot; {signedAt}
          {draft.eoIds.length > 0 &&
            ` \u00b7 ${draft.eoIds.length} order${draft.eoIds.length === 1 ? "" : "s"}`}
          {isMine && " \u00b7 created in this session"}
        </span>
      </div>

      {orderLabels.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          About{" "}
          {orderLabels.map((label, index) => (
            <span key={label.id}>
              {index > 0 && " · "}
              <Link href={`/eo/${label.id}`} className="text-link hover:underline">
                {label.reference}
              </Link>{" "}
              {label.title}
            </span>
          ))}
        </p>
      )}

      {/* Nothing here has been through a person. Said on every row rather
          than once at the top, because a reader reusing one may well have
          scrolled past the heading. */}
      {!draft.reviewedAt && (
        <p className="mt-1 text-xs text-danger">Not reviewed for accuracy by a person.</p>
      )}

      <p
        className={`mt-2 text-sm whitespace-pre-wrap text-foreground/90 ${expanded ? "" : "line-clamp-3"}`}
      >
        {expanded ? draft.draftText : draft.draftText.slice(0, PREVIEW_CHARS)}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="text-link hover:underline"
        >
          {expanded ? "Show less" : "Read the whole draft"}
        </button>

        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(draft.draftText)}
          className="text-link hover:underline"
        >
          Copy
        </button>

        {deleteToken && (
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="text-danger hover:underline disabled:opacity-50"
          >
            {deleting ? "Deleting\u2026" : isMine ? "Delete (yours)" : "Delete (admin)"}
          </button>
        )}

        {error && <span className="text-danger">{error}</span>}
      </div>
    </li>
  );
}
