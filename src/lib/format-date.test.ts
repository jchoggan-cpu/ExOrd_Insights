import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format-date";

const ORIGINAL_TZ = process.env.TZ;

/**
 * Pulls the day-of-month back out of a formatted "Sep 29, 2025" /
 * "September 29, 2025" string, so tests can check formatDate against the
 * ISO string's own components rather than against a hardcoded rendering.
 */
function extractDisplayedDay(formatted: string): string {
  const match = formatted.match(/(\d{1,2}),\s*\d{4}$/);
  if (!match) throw new Error(`Unexpected formatted date: "${formatted}"`);
  return match[1];
}

describe("formatDate", () => {
  beforeEach(() => {
    // Force a timezone behind UTC. This is what actually exposes the EO
    // 14353 bug (new Date("2025-09-29") parses as UTC midnight, then
    // toLocaleDateString rendered it in local time) — running this suite's
    // host machine happens to sit in UTC would let a regression here pass
    // silently, which is exactly the failure mode that shipped.
    process.env.TZ = "America/New_York";
  });

  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("renders the day-of-month stored in the ISO string, not one day earlier", () => {
    const iso = "2025-09-29";
    expect(extractDisplayedDay(formatDate(iso))).toBe("29");
  });

  it("holds for a single-digit day too", () => {
    const iso = "2025-01-01";
    expect(extractDisplayedDay(formatDate(iso))).toBe("1");
  });

  it("defaults to the short month style", () => {
    expect(formatDate("2025-09-29")).toBe("Sep 29, 2025");
  });

  it("uses the long month style when asked", () => {
    expect(formatDate("2025-09-29", "long")).toBe("September 29, 2025");
  });

  it("returns an em dash for undefined input", () => {
    expect(formatDate(undefined)).toBe("—");
  });

  it("returns an em dash for unparseable input", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});
