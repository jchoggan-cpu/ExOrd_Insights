import Link from "next/link";
import { CONTENT_TYPE_LABELS } from "@/lib/types";
import type { SharedDraft } from "@/lib/content-drafts";

/**
 * "Somebody has already written about this order."
 *
 * Shown on an order's page, where a reader decides whether to draft
 * something. The whole point of storing drafts is that the next person finds
 * them; a list they have to think to visit does not achieve that.
 *
 * Renders nothing when there are none, like every other section on that page.
 */
export function DraftsAboutOrder({ drafts }: { drafts: SharedDraft[] }) {
  if (drafts.length === 0) return null;

  return (
    <div className="mt-3 rounded border border-brand/30 bg-brand/10 px-3 py-2 text-sm">
      <p className="font-medium text-primary">
        {drafts.length} draft{drafts.length === 1 ? " has" : "s have"} already been written about
        this order
      </p>
      <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
        {drafts.slice(0, 5).map((draft) => (
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
        Read them in Shared Drafts
      </Link>
    </div>
  );
}
