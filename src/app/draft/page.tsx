import { getExecutiveOrders, isUsingLocalData } from "@/lib/data";
import { ContentDrafter } from "@/components/content-drafter";
import { LocalDataBanner } from "@/components/local-data-banner";
import { hasRequestTokenSecret, mintRequestToken } from "@/lib/request-token";

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ eoId?: string }>;
}) {
  const { eoId } = await searchParams;
  const orders = await getExecutiveOrders();
  const usingLocalData = isUsingLocalData();
  // Minted per render and handed to the client component, which sends it back
  // on every generate call. Null rather than a throw when the secret isn't
  // set, so a checkout with no .env.local still renders a working tracker and
  // an explicitly disabled Generate button instead of a 500.
  const requestToken = hasRequestTokenSecret() ? mintRequestToken() : null;

  return (
    <main className="flex flex-1 flex-col">
      {usingLocalData && <LocalDataBanner />}
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-foreground">
            Draft Content
          </h1>
          <p className="mt-1 text-muted">
            Generate a client alert, blog post, talking points, or social post grounded in
            one or more executive orders below.
          </p>
        </div>
        <ContentDrafter orders={orders} initialSelectedId={eoId} requestToken={requestToken} />
      </div>
    </main>
  );
}
