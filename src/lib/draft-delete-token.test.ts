import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mintDeleteToken, verifyDeleteToken } from "@/lib/draft-delete-token";

const ORIGINAL = process.env.REQUEST_TOKEN_SECRET;

beforeEach(() => {
  process.env.REQUEST_TOKEN_SECRET = "test-secret-for-drafts";
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.REQUEST_TOKEN_SECRET;
  else process.env.REQUEST_TOKEN_SECRET = ORIGINAL;
});

describe("draft delete tokens", () => {
  it("accepts the token it minted for that draft", () => {
    const token = mintDeleteToken("draft-a")!;
    expect(verifyDeleteToken("draft-a", token)).toBe(true);
  });

  it("refuses a token minted for a different draft", () => {
    // The shared list publishes every id, so without this anyone holding one
    // valid token could delete every draft in the table.
    const token = mintDeleteToken("draft-a")!;
    expect(verifyDeleteToken("draft-b", token)).toBe(false);
  });

  it("refuses a missing, empty or malformed token", () => {
    expect(verifyDeleteToken("draft-a", null)).toBe(false);
    expect(verifyDeleteToken("draft-a", "")).toBe(false);
    expect(verifyDeleteToken("draft-a", "not-a-token")).toBe(false);
  });

  it("refuses a token of the right shape but the wrong signature", () => {
    const token = mintDeleteToken("draft-a")!;
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyDeleteToken("draft-a", tampered)).toBe(false);
  });

  it("is stable, so a token kept in sessionStorage still works later", () => {
    expect(mintDeleteToken("draft-a")).toBe(mintDeleteToken("draft-a"));
  });

  it("changes entirely when the secret does", () => {
    const before = mintDeleteToken("draft-a");
    process.env.REQUEST_TOKEN_SECRET = "a-different-secret";
    expect(mintDeleteToken("draft-a")).not.toBe(before);
    // A token from the old secret must stop working, not keep working.
    expect(verifyDeleteToken("draft-a", before!)).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    // Otherwise an unconfigured deployment would allow every delete rather
    // than none -- the same failure mode request-token.ts guards against.
    delete process.env.REQUEST_TOKEN_SECRET;
    expect(mintDeleteToken("draft-a")).toBeNull();
    expect(verifyDeleteToken("draft-a", "anything")).toBe(false);
  });
});
