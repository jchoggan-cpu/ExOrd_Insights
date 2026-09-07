import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

function requestWithAuth(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("https://example.com/api/cron/ingest", { headers });
}

describe("isAuthorizedCronRequest", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("authorizes a request bearing the exact configured secret", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer test-secret"))).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedCronRequest(requestWithAuth(null))).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer wrong-secret"))).toBe(false);
  });

  it("rejects a header missing the Bearer prefix", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("test-secret"))).toBe(false);
  });

  it("fails closed when CRON_SECRET isn't configured, even with a matching-looking header", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer undefined"))).toBe(false);
  });
});
