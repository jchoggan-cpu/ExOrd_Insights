import { getExecutiveOrders, isUsingSampleData } from "@/lib/data";
import { ContentDrafter } from "@/components/content-drafter";
import { SampleDataBanner } from "@/components/sample-data-banner";

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ eoId?: string }>;
}) {
  const { eoId } = await searchParams;
  const orders = await getExecutiveOrders();
  const usingSampleData = isUsingSampleData();

  return (
    <main className="flex flex-1 flex-col">
      {usingSampleData && <SampleDataBanner />}
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
        <ContentDrafter orders={orders} initialSelectedId={eoId} />
      </div>
    </main>
  );
}
