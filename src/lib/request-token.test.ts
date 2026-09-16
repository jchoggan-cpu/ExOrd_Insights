import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REQUEST_TOKEN_HEADER,
  REQUEST_TOKEN_TTL_MS,
  hasRequestTokenSecret,
  mintRequestToken,
  rejectionMessage,
  verifyRequest,
  verifyRequestToken,
} from "@/lib/request-token";

const SECRET = "test-secret-value";
const NOW = 1_700_000_000_000;

beforeEach(() => {
  process.env.REQUEST_TOKEN_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.REQUEST_TOKEN_SECRET;
});

describe("mintRequestToken", () => {
  it("mints a token that verifies immediately", () => {
    expect(verifyRequestToken(mintRequestToken(NOW), NOW)).toEqual({ ok: true });
  });

  it("throws rather than minting an unsigned token when the secret is missing", () => {
    delete process.env.REQUEST_TOKEN_SECRET;
    expect(() => mintRequestToken(NOW)).toThrow(/REQUEST_TOKEN_SECRET/);
  });
});

describe("verifyRequestToken", () => {
  it("accepts a token right up to the moment it expires", () => {
    const token = mintRequestToken(NOW);
    expect(verifyRequestToken(token, NOW + REQUEST_TOKEN_TTL_MS - 1)).toEqual({ ok: true });
  });

  it("rejects a token the instant it expires", () => {
    const token = mintRequestToken(NOW);
    expect(verifyRequestToken(token, NOW + REQUEST_TOKEN_TTL_MS)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token whose expiry has been pushed out by hand", () => {
    const token = mintRequestToken(NOW);
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${NOW + REQUEST_TOKEN_TTL_MS * 100}.${signature}`;

    expect(verifyRequestToken(forged, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintRequestToken(NOW);
    process.env.REQUEST_TOKEN_SECRET = "a-different-secret";

    expect(verifyRequestToken(token, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("reports a forged token as a bad signature, not as expired", () => {
    // Otherwise the response distinguishes "you guessed wrong" from "you are
    // merely late", which tells an attacker which half of the token to work on.
    const expired = `${NOW - 1}.deadbeef`;
    expect(verifyRequestToken(expired, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a missing token", () => {
    expect(verifyRequestToken(null, NOW)).toEqual({ ok: false, reason: "missing" });
  });

  it.each([["no-separator"], [".onlysignature"], ["12345."], ["notanumber.abc"], [""]])(
    "rejects the malformed token %j",
    (token) => {
      const result = verifyRequestToken(token, NOW);
      expect(result.ok).toBe(false);
    },
  );

  it("fails closed when the secret is unset, rather than waving the request through", () => {
    const token = mintRequestToken(NOW);
    delete process.env.REQUEST_TOKEN_SECRET;

    expect(verifyRequestToken(token, NOW)).toEqual({ ok: false, reason: "not-configured" });
  });
});

describe("verifyRequest", () => {
  it("reads the token off the request header", () => {
    const request = new Request("https://example.test/api/generate-content", {
      headers: { [REQUEST_TOKEN_HEADER]: mintRequestToken(NOW) },
    });

    expect(verifyRequest(request, NOW)).toEqual({ ok: true });
  });

  it("rejects a request carrying no token header at all", () => {
    const request = new Request("https://example.test/api/generate-content");
    expect(verifyRequest(request, NOW)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("hasRequestTokenSecret", () => {
  it("reports whether the secret is configured", () => {
    expect(hasRequestTokenSecret()).toBe(true);
    delete process.env.REQUEST_TOKEN_SECRET;
    expect(hasRequestTokenSecret()).toBe(false);
  });
});

describe("rejectionMessage", () => {
  it("tells the user how to recover from an expired token, since that is the only reason with a fix", () => {
    expect(rejectionMessage("expired")).toContain("reload the page");
  });

  it("does not hint at why a forged or missing token failed", () => {
    expect(rejectionMessage("bad-signature")).toBe("Unauthorized.");
    expect(rejectionMessage("missing")).toBe("Unauthorized.");
  });
});
