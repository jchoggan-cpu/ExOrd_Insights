import { describe, expect, it } from "vitest";
import { ADMIN_API_ROUTES, ADMIN_MATCHER, ADMIN_ROUTES, isAdminRoute } from "@/lib/admin-routes";

describe("isAdminRoute", () => {
  it("covers every admin page and its sub-paths", () => {
    for (const route of [...ADMIN_ROUTES, ...ADMIN_API_ROUTES]) {
      expect(isAdminRoute(route)).toBe(true);
      expect(isAdminRoute(`${route}/anything`)).toBe(true);
    }
  });

  it("leaves the pages the tracker is meant to share wide open", () => {
    for (const open of ["/", "/eo/abc-123", "/draft", "/gate", "/api/generate-content"]) {
      expect(isAdminRoute(open)).toBe(false);
    }
  });

  it("does NOT gate the cron routes", () => {
    // Vercel Cron sends a plain GET and expects JSON. A redirect to an HTML
    // password page would break the nightly jobs silently -- they would
    // "succeed" with a 307 and do nothing. They carry their own CRON_SECRET
    // check instead (src/lib/cron-auth.ts).
    for (const cron of [
      "/api/cron/ingest",
      "/api/cron/enrich",
      "/api/cron/reconcile",
      "/api/cron/watchdog",
    ]) {
      expect(isAdminRoute(cron)).toBe(false);
      expect(ADMIN_MATCHER.some((pattern) => pattern.startsWith(cron))).toBe(false);
    }
  });

  it("does not gate a route that merely starts with an admin route's name", () => {
    expect(isAdminRoute("/usage-report")).toBe(false);
    expect(isAdminRoute("/prompts")).toBe(false);
  });

  it("gates the endpoint behind the prompt page, not just the page", () => {
    // Protecting /prompt while leaving /api/summary-prompt open would
    // protect nothing: the endpoint is where the prompt is actually written.
    expect(isAdminRoute("/api/summary-prompt")).toBe(true);
  });

  it("produces a matcher entry for each route and its sub-paths", () => {
    expect(ADMIN_MATCHER).toContain("/usage");
    expect(ADMIN_MATCHER).toContain("/usage/:path*");
    expect(ADMIN_MATCHER).toHaveLength((ADMIN_ROUTES.length + ADMIN_API_ROUTES.length) * 2);
  });
});

describe("the proxy's matcher and this list", () => {
  it("stay in step", async () => {
    // src/proxy.ts cannot import ADMIN_MATCHER: Next parses the matcher at
    // build time and rejects a computed value. So the patterns are written
    // out there and checked against the list here -- otherwise adding an
    // admin page to this file would hide its link while leaving the page
    // itself open to anyone with the URL.
    const { readFileSync } = await import("node:fs");
    const proxySource = readFileSync("src/proxy.ts", "utf8");

    for (const pattern of ADMIN_MATCHER) {
      expect(proxySource).toContain(`"${pattern}"`);
    }

    const matcherBlock = proxySource.slice(proxySource.indexOf("matcher: ["));
    const declared = [...matcherBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...ADMIN_MATCHER].sort());
  });
});
