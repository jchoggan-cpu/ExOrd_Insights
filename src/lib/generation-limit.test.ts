import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTENT_GENERATIONS_PER_HOUR,
  GENERATION_WINDOW_MS,
  checkGenerationLimit,
  decideFromCount,
  limitMessage,
} from "@/lib/generation-limit";

/**
 * A stub narrow enough to record exactly what the limiter asked the database,
 * which is the part worth asserting: the shared federal-register fake does not
 * support `count`/`head` or `gte`.
 */
function stubSupabase({ count, error }: { count?: number; error?: string }) {
  const calls: { column: string; value: unknown }[] = [];
  const builder = {
    eq(column: string, value: unknown) {
      calls.push({ column, value });
      return builder;
    },
    gte(column: string, value: unknown) {
      calls.push({ column, value });
      return Promise.resolve(
        error ? { count: null, error: { message: error } } : { count: count ?? 0, error: null },
      );
    },
  };
  const client = {
    calls,
    from: () => ({ select: () => builder }),
  };
  return client as unknown as SupabaseClient & { calls: typeof calls };
}

describe("decideFromCount", () => {
  it("allows a request when the window is empty", () => {
    expect(decideFromCount(0)).toEqual({ allowed: true, used: 0 });
  });

  it("allows the last request under the ceiling", () => {
    const decision = decideFromCount(CONTENT_GENERATIONS_PER_HOUR - 1);
    expect(decision.allowed).toBe(true);
  });

  it("blocks once the ceiling is reached", () => {
    const decision = decideFromCount(CONTENT_GENERATIONS_PER_HOUR);
    expect(decision.allowed).toBe(false);
  });

  it("blocks when the ceiling has been overshot by concurrent requests", () => {
    expect(decideFromCount(CONTENT_GENERATIONS_PER_HOUR + 5).allowed).toBe(false);
  });

  it("reports a retry window a caller can act on", () => {
    const decision = decideFromCount(CONTENT_GENERATIONS_PER_HOUR);
    if (decision.allowed) throw new Error("expected the request to be blocked");
    expect(decision.retryAfterSeconds).toBe(GENERATION_WINDOW_MS / 1000);
  });
});

describe("checkGenerationLimit", () => {
  it("counts only billed content generations, inside the trailing window", async () => {
    const supabase = stubSupabase({ count: 3 });
    const now = new Date("2026-09-16T12:00:00.000Z");

    const decision = await checkGenerationLimit(supabase, now);

    expect(decision).toEqual({ allowed: true, used: 3 });
    expect(supabase.calls).toEqual([
      { column: "feature", value: "content" },
      { column: "created_at", value: "2026-09-16T11:00:00.000Z" },
    ]);
  });

  it("blocks when the window is already full", async () => {
    const decision = await checkGenerationLimit(stubSupabase({ count: CONTENT_GENERATIONS_PER_HOUR }));
    expect(decision.allowed).toBe(false);
  });

  it("allows the request but says loudly that the ceiling is unenforced when the count query fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const decision = await checkGenerationLimit(stubSupabase({ error: "connection reset" }));

    expect(decision).toEqual({ allowed: true, used: 0 });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("NOT being enforced"),
      "connection reset",
    );
    logged.mockRestore();
  });
});

describe("limitMessage", () => {
  it("tells the caller the ceiling, the usage and how long to wait", () => {
    const decision = decideFromCount(CONTENT_GENERATIONS_PER_HOUR);
    if (decision.allowed) throw new Error("expected the request to be blocked");

    const message = limitMessage(decision);
    expect(message).toContain(String(CONTENT_GENERATIONS_PER_HOUR));
    expect(message).toContain("60 minutes");
  });
});
