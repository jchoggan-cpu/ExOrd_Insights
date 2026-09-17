import { describe, expect, it, vi } from "vitest";
import { resolveRunStatus } from "@/lib/federal-register/run-status";

describe("resolveRunStatus", () => {
  it("reports success when every item succeeded", () => {
    expect(resolveRunStatus({ attempted: 20, failed: 0 })).toBe("success");
  });

  it("reports success when there was nothing to attempt", () => {
    // An ingest run that found no new documents, or an enrichment run with
    // an empty queue, did exactly what it was asked to.
    expect(resolveRunStatus({ attempted: 0, failed: 0 })).toBe("success");
  });

  it("reports partial when some items failed and some succeeded", () => {
    expect(resolveRunStatus({ attempted: 20, failed: 1 })).toBe("partial");
    expect(resolveRunStatus({ attempted: 20, failed: 19 })).toBe("partial");
  });

  it("reports failure — not partial — when every item failed", () => {
    // The whole point of this module: a systematically broken run (a bad
    // credential, an API erroring on everything) must not look like a
    // mostly-healthy one to whatever decides whether to raise an alert.
    expect(resolveRunStatus({ attempted: 20, failed: 20 })).toBe("failure");
    expect(resolveRunStatus({ attempted: 1, failed: 1 })).toBe("failure");
  });

  it("takes the conservative branch and says so when given more failures than attempts", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveRunStatus({ attempted: 2, failed: 3 })).toBe("failure");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("more failures (3) than attempts (2)"));
    logged.mockRestore();
  });
});
