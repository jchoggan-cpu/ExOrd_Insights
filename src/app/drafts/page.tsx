import Link from "next/link";
import { listDrafts } from "@/lib/content-drafts";
import { getServiceRoleClient } from "@/lib/supabase";
import { hasActiveAdminSession } from "@/lib/site-access";
import { mintDeleteToken } from "@/lib/draft-delete-token";
import { DraftListItem } from "@/components/draft-list-item";

/**
 * Every draft the team has generated, newest first.
 *
 * Public on purpose: the point of saving drafts is that colleagues can see
 * and reuse them, so gating this page would defeat it. Delete is what is
 * restricted, not reading.
 *
 * Read with the service-role client because content_drafts' RLS was written
 * for Phase 5 accounts and no anonymous reader can satisfy it -- see
 * src/lib/content-drafts.ts. Only the columns safe to show anyone are
 * selected.
 */
export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const isAdmin = await hasActiveAdminSession();
  const drafts = await listDrafts(getServiceRoleClient());

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[120rem] flex-1 px-4 py-5">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-semibold text-foreground">Shared drafts</h1>
          <p className="mt-0.5 text-base font-semibold text-foreground">
            Everything the team has generated, newest first — read one, reuse it, or start from it.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafts are saved automatically and are not attributed to anyone, because the tracker
            has no accounts yet. Nothing here has been checked for accuracy by a person.
          </p>
        </div>

        {drafts.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-muted-foreground">
            No drafts yet. Generate one from{" "}
            <Link href="/draft" className="text-link hover:underline">
              Create Alert/Content
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {drafts.map((draft) => (
              <DraftListItem
                key={draft.id}
                draft={draft}
                /* Minted server-side and handed only to a page an admin can
                   open. A reader without the gate gets nothing, so the
                   delete button never appears for them. */
                adminDeleteToken={isAdmin ? mintDeleteToken(draft.id) : null}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
