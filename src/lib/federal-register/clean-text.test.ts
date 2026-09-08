import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanFederalRegisterText } from "@/lib/federal-register/clean-text";

const FIXTURE_DIR = join(__dirname, "fixtures");

describe("cleanFederalRegisterText", () => {
  it("strips the HTML shell, header/footer boilerplate, and page-break markers from a real order", () => {
    const raw = readFileSync(join(FIXTURE_DIR, "eo-14421-raw-text.txt"), "utf-8");

    const cleaned = cleanFederalRegisterText(raw);

    expect(cleaned).not.toMatch(/<[^>]+>/);
    expect(cleaned).not.toContain("[[Page");
    expect(cleaned).not.toContain("[FR Doc");
    expect(cleaned).not.toContain("Billing code");
    expect(cleaned).not.toContain("www.gpo.gov");
    expect(cleaned).not.toMatch(/Federal Register\s*\/\s*Vol\./);
    // The order's actual substance must survive.
    expect(cleaned).toContain("Executive Order 14421 of August 26, 2026");
    expect(cleaned).toContain(
      "Declaring a National Emergency To Secure the United States Bulk-Power System",
    );
    expect(cleaned).toContain("THE WHITE HOUSE");
    // No leftover multi-space runs from the fixed-width typesetting.
    expect(cleaned).not.toMatch(/ {2,}/);
    // This fixture is a real captured sample and contains literal NUL bytes
    // around its masthead/page-break markers — Postgres/PostgREST can't
    // store those in a text column at all ("unsupported Unicode escape
    // sequence"), so none may survive cleaning.
    expect(cleaned).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
  });

  it("strips NUL and other C0 control characters, not just visible artifacts", () => {
    const withNul = "Section 1. Purpose.\x00\x00 The order continues here.";
    expect(cleanFederalRegisterText(withNul)).toBe("Section 1. Purpose. The order continues here.");
  });

  it("is a no-op on already-clean text", () => {
    const text = "This is a plain sentence with no artifacts.";
    expect(cleanFederalRegisterText(text)).toBe(text);
  });

  it("handles empty input without throwing", () => {
    expect(cleanFederalRegisterText("")).toBe("");
  });
});
