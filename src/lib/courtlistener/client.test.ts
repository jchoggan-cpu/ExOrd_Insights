import { describe, expect, it, vi } from "vitest";
import { createDocketSearch, docketUrl } from "@/lib/courtlistener/client";
import type { CourtListenerDocket } from "@/lib/courtlistener/types";

function okResponse(results: unknown[]): Response {
  return new Response(JSON.stringify({ results }), { status: 200 });
}

function errorResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response("", { status, headers });
}

describe("createDocketSearch", () => {
  it("sends the case name as a quoted phrase, constrained to the court", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse([]));
    await createDocketSearch({ fetchImpl, token: null })({ caseName: "Doe v. Noem", courtId: "mad" });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe('caseName:("Doe v. Noem")');
    expect(url.searchParams.get("court")).toBe("mad");
    expect(url.searchParams.get("type")).toBe("r");
  });

  it("omits the court filter when the court could not be resolved", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse([]));
    await createDocketSearch({ fetchImpl, token: null })({ caseName: "Doe v. Noem", courtId: null });

    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.has("court")).toBe(false);
  });

  it("sends no Authorization header when there is no token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse([]));
    await createDocketSearch({ fetchImpl, token: null })({ caseName: "A v. B" });

    const headers = (fetchImpl.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("authenticates when a token is supplied", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse([]));
    await createDocketSearch({ fetchImpl, token: "secret" })({ caseName: "A v. B" });

    const headers = (fetchImpl.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Token secret");
  });

  // Anonymous callers really do get 429ed part-way through a full run, so
  // recovering from it is normal operation rather than an edge case.
  it("backs off and retries a rate-limited request", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse([{ caseName: "A v. B" }]));
    const sleep = vi.fn(async () => {});

    const results = await createDocketSearch({ fetchImpl, sleep, token: null })({ caseName: "A v. B" });

    expect(results.dockets).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("waits exactly as long as the server's Retry-After asks", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(429, { "retry-after": "3" }))
      .mockResolvedValueOnce(okResponse([]));
    const sleep = vi.fn(async () => {});

    await createDocketSearch({ fetchImpl, sleep, token: null })({ caseName: "A v. B" });

    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("gives up after repeated throttling rather than reporting an empty result", async () => {
    // The distinction this protects: a refused request must never be
    // recorded as "this case has no docket".
    const fetchImpl = vi.fn<typeof fetch>(async () => errorResponse(429));
    const sleep = vi.fn(async () => {});

    await expect(createDocketSearch({ fetchImpl, sleep, token: null })({ caseName: "A v. B" })).rejects.toThrow("429");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("does not retry a non-throttling failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => errorResponse(500));
    const sleep = vi.fn(async () => {});

    await expect(createDocketSearch({ fetchImpl, sleep, token: null })({ caseName: "A v. B" })).rejects.toThrow("500");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the search genuinely matched nothing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({}), { status: 200 }));
    expect(await createDocketSearch({ fetchImpl, token: null })({ caseName: "Ghost v. Nobody" })).toEqual({
      dockets: [],
      truncated: false,
    });
  });
  // CourtListener pages at 20 results; the gate must know when it has not
  // seen everything, or its "no rival docket" test is a guess.
  it("reports truncation when the response has another page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ results: [], next: "https://example.com/page2" }), { status: 200 }),
    );
    const result = await createDocketSearch({ fetchImpl, token: null })({ caseName: "A v. B" });

    expect(result.truncated).toBe(true);
  });
});

describe("docketUrl", () => {
  it("expands CourtListener's site-relative path into a full URL", () => {
    const docket = { docket_absolute_url: "/docket/69742076/jgg-v-trump/" } as CourtListenerDocket;
    expect(docketUrl(docket)).toBe("https://www.courtlistener.com/docket/69742076/jgg-v-trump/");
  });
});
