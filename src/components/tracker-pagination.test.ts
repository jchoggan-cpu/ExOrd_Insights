import { describe, expect, it } from "vitest";
import { paginationRange } from "@/components/tracker-pagination";

describe("paginationRange", () => {
  it("lists every page when they all fit", () => {
    expect(paginationRange(1, 3)).toEqual([1, 2, 3]);
  });

  it("collapses the middle with a gap on a long run", () => {
    // 25 pages of numbers would wrap across the screen.
    expect(paginationRange(12, 25)).toEqual([1, "gap", 11, 12, 13, "gap", 25]);
  });

  it("keeps first and last visible from anywhere", () => {
    const range = paginationRange(13, 25);
    expect(range[0]).toBe(1);
    expect(range.at(-1)).toBe(25);
  });

  it("does not emit a gap for a single skipped page", () => {
    // With pages 1 and 3 adjacent to the window, "1 … 3" would be sillier
    // than just showing 2.
    expect(paginationRange(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles the first and last pages without duplicating them", () => {
    expect(paginationRange(1, 25)).toEqual([1, 2, "gap", 25]);
    expect(paginationRange(25, 25)).toEqual([1, "gap", 24, 25]);
  });

  it("handles a single page", () => {
    expect(paginationRange(1, 1)).toEqual([1]);
  });

  it("never repeats a page number", () => {
    for (const [current, total] of [[1, 1], [1, 2], [2, 3], [13, 25], [25, 25]] as const) {
      const numbers = paginationRange(current, total).filter((p): p is number => p !== "gap");
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });
});
