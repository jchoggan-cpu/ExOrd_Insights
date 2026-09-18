import { describe, expect, it } from "vitest";
import type { HealthReport } from "@/lib/alerts/check-health";
import { formatAlert } from "@/lib/alerts/format-alert";

const SITE = "https://ex-ord-insights.vercel.app";

function report(overrides: Partial<HealthReport> = {}): HealthReport {
  return { problems: [], isAllClearDay: false, shouldStaySilent: false, ...overrides };
}

describe("formatAlert", () => {
  it("writes an all-clear that explains why its own absence matters", () => {
    const text = formatAlert(report({ isAllClearDay: true }), SITE);
    expect(text).toContain("weekly all-clear");
    expect(text).toContain("that itself is the alarm");
    expect(text).toContain(`${SITE}/needs-attention`);
  });

  it("lists each problem with its headline and detail", () => {
    const text = formatAlert(
      report({
        problems: [
          { kind: "missing_run", headline: "ingest has not run since 30h ago", detail: "Expected within 25h." },
          { kind: "bad_run", headline: "enrich recorded failure", detail: "No AI credentials configured" },
        ],
      }),
      SITE,
    );
    expect(text).toContain("2 problems");
    expect(text).toContain("ingest has not run since 30h ago");
    expect(text).toContain("No AI credentials configured");
  });

  it("uses the singular for one problem", () => {
    const text = formatAlert(
      report({ problems: [{ kind: "bad_run", headline: "h", detail: "d" }] }),
      SITE,
    );
    expect(text).toContain("1 problem");
    expect(text).not.toContain("1 problems");
  });

  it("marks an on-demand channel test as not being the weekly all-clear", () => {
    // A test fired on a Thursday that read as the Monday note would be
    // worse than sending nothing: the whole value of the Monday note is
    // that its absence means something.
    const text = formatAlert(report({ isAllClearDay: false }), SITE, { forced: true });
    expect(text).toContain("channel test");
    expect(text).toContain("not the weekly all-clear");
    expect(text).not.toContain("weekly all-clear*");
  });

  it("still reports real problems normally when forced", () => {
    const text = formatAlert(
      report({ problems: [{ kind: "bad_run", headline: "enrich recorded failure", detail: "boom" }] }),
      SITE,
      { forced: true },
    );
    expect(text).toContain("1 problem");
    expect(text).toContain("enrich recorded failure");
    expect(text).not.toContain("channel test");
  });

  it("does not double the slash when the site URL has a trailing one", () => {
    const text = formatAlert(report({ isAllClearDay: true }), "https://example.com/");
    expect(text).toContain("https://example.com/needs-attention");
    expect(text).not.toContain("//needs-attention");
  });
});
