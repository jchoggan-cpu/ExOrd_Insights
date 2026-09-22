import { getSupabaseClient } from "@/lib/supabase";
import { getUsageSummary, USAGE_WINDOW_DAYS, type DailyUsage } from "@/lib/usage/daily";
import { getSummaryModel, getConfiguredModel } from "@/lib/ai-model";
import { formatDate } from "@/lib/format-date";

// Spend changes with every model call — never statically prerendered, or the
// ticker would show whatever the last build saw.
export const dynamic = "force-dynamic";

const FEATURE_LABELS: Record<string, string> = {
  summarize: "EO summaries",
  draft: "Draft-alongside pass",
  content: "Content drafting",
};

function money(usd: number): string {
  // Sub-cent amounts are normal for a single call, so a plain 2dp format
  // would render most individual days as "$0.00" and look broken.
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

function DayRow({ day, maxCost }: { day: DailyUsage; maxCost: number }) {
  // A bar rather than a chart library: one dependency-free visual cue for
  // which days were expensive.
  const widthPercent = maxCost > 0 ? Math.max(2, (day.costUsd / maxCost) * 100) : 0;

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-4 py-2.5 text-sm whitespace-nowrap text-foreground">{formatDate(day.date)}</td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground tabular-nums">{day.calls}</td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground tabular-nums">
        {tokens(day.inputTokens)} / {tokens(day.outputTokens)}
      </td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground tabular-nums">{tokens(day.cacheReadInputTokens)}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-border/60">
            <div className="h-full rounded-full bg-primary" style={{ width: `${widthPercent}%` }} />
          </div>
          <span className="text-sm font-medium tabular-nums text-foreground">{money(day.costUsd)}</span>
        </div>
      </td>
    </tr>
  );
}

export default async function UsagePage() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="font-display text-3xl font-semibold text-foreground">API Spend</h1>
        <p className="mt-3 text-muted-foreground">
          Supabase isn&apos;t configured, so no usage has been recorded. See the README.
        </p>
      </main>
    );
  }

  const summary = await getUsageSummary(supabase);
  const maxCost = Math.max(0, ...summary.days.map((d) => d.costUsd));
  const todayFeatures = Object.entries(summary.today.byFeature);

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-foreground">API Spend</h1>
          <p className="mt-1 max-w-3xl text-muted-foreground">
            Every model call this app makes, priced and totalled by day. Recorded at the moment of
            the call, so a later price change never rewrites what a past run cost. Summaries use{" "}
            <code className="font-mono text-sm text-foreground">{getSummaryModel()}</code>; content
            drafting uses <code className="font-mono text-sm text-foreground">{getConfiguredModel()}</code>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Today (UTC)</p>
            <p className="mt-1 font-display text-3xl font-semibold text-foreground tabular-nums">
              {money(summary.today.costUsd)}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{summary.today.calls} calls</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Last {USAGE_WINDOW_DAYS} days
            </p>
            <p className="mt-1 font-display text-3xl font-semibold text-foreground tabular-nums">
              {money(summary.windowCostUsd)}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {summary.days.reduce((n, d) => n + d.calls, 0)} calls
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Today by feature</p>
            {todayFeatures.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No calls yet today.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {todayFeatures.map(([feature, stats]) => (
                  <li key={feature} className="flex justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{FEATURE_LABELS[feature] ?? feature}</span>
                    <span className="tabular-nums text-foreground">{money(stats.costUsd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {summary.today.unpricedCalls > 0 && (
          <div className="mt-4 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
            {summary.today.unpricedCalls} call(s) today used a model with no entry in the rate table
            (<code className="font-mono text-xs">src/lib/usage/pricing.ts</code>), so the totals above
            understate the real spend.
          </div>
        )}

        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold text-foreground">Daily breakdown</h2>
          {summary.days.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No API calls recorded in the last {USAGE_WINDOW_DAYS} days.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[34rem]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Day</th>
                    <th className="px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Calls</th>
                    <th className="px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">In / Out</th>
                    <th className="px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Cached</th>
                    <th className="px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.days.map((day) => (
                    <DayRow key={day.date} day={day} maxCost={maxCost} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            &ldquo;Cached&rdquo; counts input tokens served from the prompt cache at a tenth the
            normal rate. If that column reads 0 while summaries are running, prompt caching has
            stopped working and the bill is roughly double what it should be.
          </p>
        </section>
      </div>
    </main>
  );
}
