import { getExecutiveOrders, isUsingLocalData } from "@/lib/data";
import { ContentDrafter } from "@/components/content-drafter";
import { LocalDataBanner } from "@/components/local-data-banner";
import { hasRequestTokenSecret, mintRequestToken } from "@/lib/request-token";
import { DRAFT_ID_PARAM } from "@/lib/eo-selection";
import { listDrafts } from "@/lib/content-drafts";
import { getServiceRoleClient } from "@/lib/supabase";

export default async function DraftPage({
  searchParams,
}: {
  // Repeated, so Next hands over an array when the tracker's selection bar
  // sends several orders and a bare string when a single link sends one.
  searchParams: Promise<{ [DRAFT_ID_PARAM]?: string | string[] }>;
}) {
  const eoId = (await searchParams)[DRAFT_ID_PARAM];
  const initialSelectedIds = eoId === undefined ? [] : Array.isArray(eoId) ? eoId : [eoId];
  const orders = await getExecutiveOrders();
  const usingLocalData = isUsingLocalData();
  // Minted per render and handed to the client component, which sends it back
  // on every generate call. Null rather than a throw when the secret isn't
  // set, so a checkout with no .env.local still renders a working tracker and
  // an explicitly disabled Generate button instead of a 500.
  const requestToken = hasRequestTokenSecret() ? mintRequestToken() : null;

  // Loaded once and filtered in the browser as the selection changes, rather
  // than a round trip per tick. Drafts are few and only their metadata is
  // needed to say "this already exists". Non-fatal: not knowing about an
  // existing draft must not stop someone writing a new one.
  let existingDrafts: Awaited<ReturnType<typeof listDrafts>> = [];
  try {
    existingDrafts = await listDrafts(getServiceRoleClient(), 200);
  } catch (err) {
    console.error("Could not load existing drafts for the duplicate check:", err);
  }

  return (
    <main className="flex flex-1 flex-col">
      {usingLocalData && <LocalDataBanner />}
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-foreground">
            Draft Content
          </h1>
          <p className="mt-1 text-muted-foreground">
            Generate a client alert, blog post, talking points, or social post grounded in
            one or more executive orders below.
          </p>
        </div>
        <ContentDrafter
          orders={orders}
          initialSelectedIds={initialSelectedIds}
          existingDrafts={existingDrafts}
          requestToken={requestToken}
        />
      </div>
    </main>
  );
}
