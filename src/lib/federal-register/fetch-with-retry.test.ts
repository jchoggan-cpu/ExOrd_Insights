import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffMs, createRetryingFetch } from "@/lib/federal-register/fetch-with-retry";

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response("body", { status, headers });
}

describe("createRetryingFetch", () => {
  // Several tests below retry on purpose; the warning is asserted in its
  // own test rather than printed by every one of them.
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first response when the server answers normally, without sleeping", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(200));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const result = await createRetryingFetch({ fetchImpl, sleep })("https://example.test/doc.txt");

    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  // The failure this whole module exists for: 2026-09-19, 47 raw-text
  // requests, 47 429s, run dead in 0.42 seconds.
  it("retries a 429 and succeeds on the next attempt", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const result = await createRetryingFetch({ fetchImpl, sleep })("https://example.test/doc.txt");

    expect(result.status).toBe(200);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("backs off exponentially across attempts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(503));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    await createRetryingFetch({ fetchImpl, sleep })("https://example.test/doc.txt");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([2_000, 4_000]);
  });

  it("identifies the client, as federalregister.gov's terms ask", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(200));

    await createRetryingFetch({ fetchImpl })("https://example.test/doc.txt");

    const headers = (fetchImpl.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Sheppard EO Tracker");
  });

  it("gives the request a deadline of its own, since fetch has none", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(200));

    await createRetryingFetch({ fetchImpl })("https://example.test/doc.txt");

    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  // This project's whole failure history is things that were invisible
  // until someone looked directly. A throttle we quietly rode out would
  // leave no trace in ingestion_runs or in the watchdog's view either.
  it("says out loud that it retried, so a tightening rate limit is visible before it breaks a run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));

    await createRetryingFetch({ fetchImpl, sleep: async () => {} })("https://example.test/doc.txt");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("429");
    expect(warn.mock.calls[0][0]).toContain("https://example.test/doc.txt");
    warn.mockRestore();
  });

  it("hands back the last response rather than throwing, so the caller decides what a 429 means", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(429));

    const result = await createRetryingFetch({ fetchImpl, sleep: async () => {} })("https://example.test/doc.txt");

    expect(result.status).toBe(429);
  });

  it("does not retry a status that is an answer rather than a hiccup", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(404));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const result = await createRetryingFetch({ fetchImpl, sleep })("https://example.test/doc.txt");

    expect(result.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a dropped connection, then rethrows with the URL so it is never read as 'no such document'", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("socket hang up");
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    await expect(
      createRetryingFetch({ fetchImpl, sleep })("https://example.test/doc.txt"),
    ).rejects.toThrow(/https:\/\/example\.test\/doc\.txt.*socket hang up/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("backoffMs", () => {
  it("honours the server's own Retry-After over our guess", () => {
    expect(backoffMs(new Response("", { status: 429, headers: { "retry-after": "3" } }), 1)).toBe(3_000);
  });

  // A cron function has a hard execution cap. Sleeping out an hour-long
  // penalty would hang the run until the platform killed it mid-flight.
  it("stops retrying when Retry-After is longer than a cron run can afford", () => {
    expect(backoffMs(new Response("", { status: 429, headers: { "retry-after": "3600" } }), 1)).toBeNull();
  });

  it("ignores an unusable Retry-After and falls back to exponential backoff", () => {
    expect(backoffMs(new Response("", { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } }), 1)).toBe(2_000);
    expect(backoffMs(new Response("", { status: 429, headers: { "retry-after": "0" } }), 2)).toBe(4_000);
  });

  it("caps its own exponential growth", () => {
    expect(backoffMs(null, 9)).toBe(10_000);
  });
});
