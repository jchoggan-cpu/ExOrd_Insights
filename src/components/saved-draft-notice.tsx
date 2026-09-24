"use client";

import Link from "next/link";
import { useState } from "react";
import { useSessionDrafts } from "@/components/use-session-drafts";

/**
 * Says a draft was saved for the team, and lets the session that made it
 * take it back down.
 *
 * "Yours" cannot mean an account here -- drafts are anonymous by design for
 * now -- so it means this browser session still holds the delete token it
 * was handed on generation. Once the tab is gone, so is that, and only the
 * gated admin list can remove the draft. That is recorded in the README as
 * the accepted cost of shipping before Phase 5 auth.
 */
export function SavedDraftNotice({
  draftId,
  onDeleted,
  onError,
}: {
  draftId: string;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const { forget, tokenFor } = useSessionDrafts();
  const [deleting, setDeleting] = useState(false);

  const deleteToken = tokenFor(draftId);

  async function handleDelete() {
    if (!deleteToken) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/content-drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId, deleteToken }),
      });
      if (!res.ok) throw new Error("Delete failed");
      forget(draftId);
      onDeleted();
    } catch {
      onError("Could not remove that draft from the shared list.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded border border-border bg-muted/50 px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        Saved to the shared drafts, visible to everyone using the tracker.
      </span>
      <Link href="/drafts" className="text-link hover:underline">
        See all drafts
      </Link>
      {deleteToken && (
        <button
          type="button"
          disabled={deleting}
          onClick={handleDelete}
          className="text-danger hover:underline disabled:opacity-50"
        >
          {deleting ? "Removing\u2026" : "Delete from shared drafts"}
        </button>
      )}
    </div>
  );
}
