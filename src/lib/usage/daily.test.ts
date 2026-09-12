import { describe, expect, it } from "vitest";
import { summarizeUsageRows, utcDateKey } from "@/lib/usage/daily";

function row(overrides: Partial<Parameters<typeof summarizeUsageRows>[0][number]> = {}) {
  return {
    feature: "summarize",
    model: "claude-fable-5",
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 3000,
    cost_usd: "0.050000",
    priced: true,
    created_at: "2026-09-12T10:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeUsageRows", () => {
  it("totals a day's calls and cost", () => {
    const summary = summarizeUsageRows([row(), row(), row()], "2026-09-12");

    expect(summary.today.calls).toBe(3);
    expect(summary.today.costUsd).toBeCloseTo(0.15, 6);
    expect(summary.today.cacheReadInputTokens).toBe(9000);
  });

  it("parses numeric costs that PostgREST returns as strings", () => {
    // numeric columns arrive as strings to avoid float drift; treating them
    // as numbers without parsing would silently total to zero.
    const summary = summarizeUsageRows([row({ cost_usd: "1.234567" })], "2026-09-12");
    expect(summary.today.costUsd).toBeCloseTo(1.234567, 6);
  });

  it("separates days on the UTC boundary, matching how the provider bills", () => {
    const summary = summarizeUsageRows(
      [
        row({ created_at: "2026-09-12T23:59:00.000Z" }),
        row({ created_at: "2026-09-13T00:01:00.000Z" }),
      ],
      "2026-09-13",
    );

    expect(summary.days).toHaveLength(2);
    expect(summary.today.date).toBe("2026-09-13");
    expect(summary.today.calls).toBe(1);
  });

  it("orders days most recent first", () => {
    const summary = summarizeUsageRows(
      [
        row({ created_at: "2026-09-10T10:00:00.000Z" }),
        row({ created_at: "2026-09-12T10:00:00.000Z" }),
        row({ created_at: "2026-09-11T10:00:00.000Z" }),
      ],
      "2026-09-12",
    );

    expect(summary.days.map((d) => d.date)).toEqual(["2026-09-12", "2026-09-11", "2026-09-10"]);
  });

  it("breaks a day down by feature", () => {
    const summary = summarizeUsageRows(
      [row({ feature: "summarize" }), row({ feature: "summarize" }), row({ feature: "content" })],
      "2026-09-12",
    );

    expect(summary.today.byFeature.summarize.calls).toBe(2);
    expect(summary.today.byFeature.content.calls).toBe(1);
  });

  it("counts unpriced calls so a zero cost is never mistaken for a free one", () => {
    const summary = summarizeUsageRows([row({ priced: false, cost_usd: "0" })], "2026-09-12");

    expect(summary.today.unpricedCalls).toBe(1);
    expect(summary.today.calls).toBe(1);
  });

  it("reports a quiet day as $0.00 rather than as missing data", () => {
    const summary = summarizeUsageRows([], "2026-09-12");

    expect(summary.today).toMatchObject({ date: "2026-09-12", calls: 0, costUsd: 0 });
    expect(summary.days).toEqual([]);
    expect(summary.windowCostUsd).toBe(0);
  });

  it("totals the whole window, not just today", () => {
    const summary = summarizeUsageRows(
      [row({ created_at: "2026-09-10T10:00:00.000Z" }), row({ created_at: "2026-09-12T10:00:00.000Z" })],
      "2026-09-12",
    );

    expect(summary.today.costUsd).toBeCloseTo(0.05, 6);
    expect(summary.windowCostUsd).toBeCloseTo(0.1, 6);
  });
});

describe("utcDateKey", () => {
  it("keys by UTC date regardless of the runtime's timezone", () => {
    expect(utcDateKey("2026-09-12T23:59:59.000Z")).toBe("2026-09-12");
    expect(utcDateKey(new Date("2026-09-13T00:00:00.000Z"))).toBe("2026-09-13");
  });
});
