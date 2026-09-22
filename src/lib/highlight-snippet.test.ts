import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  parseSnippet,
} from "@/lib/highlight-snippet";

describe("parseSnippet", () => {
  it("returns an empty array for null, undefined, and an empty string", () => {
    expect(parseSnippet(null)).toEqual([]);
    expect(parseSnippet(undefined)).toEqual([]);
    expect(parseSnippet("")).toEqual([]);
  });

  it("returns a single non-highlighted segment when there are no markers", () => {
    expect(parseSnippet("no search terms matched here")).toEqual([
      { text: "no search terms matched here", highlighted: false },
    ]);
  });

  it("splits a well-formed snippet into alternating segments in order", () => {
    const snippet =
      "the reciprocal [[hl]]tariff[[/hl]] rates set out in Annex I, and each [[hl]]duty[[/hl]] so adjusted";
    expect(parseSnippet(snippet)).toEqual([
      { text: "the reciprocal ", highlighted: false },
      { text: "tariff", highlighted: true },
      { text: " rates set out in Annex I, and each ", highlighted: false },
      { text: "duty", highlighted: true },
      { text: " so adjusted", highlighted: false },
    ]);
  });

  it("never emits a leading empty segment when a marker starts the snippet", () => {
    const snippet = "[[hl]]tariff[[/hl]] rates set out in Annex I";
    expect(parseSnippet(snippet)).toEqual([
      { text: "tariff", highlighted: true },
      { text: " rates set out in Annex I", highlighted: false },
    ]);
  });

  it("never emits a trailing empty segment when a marker ends the snippet", () => {
    const snippet = "rates set out in Annex I, and each [[hl]]duty[[/hl]]";
    expect(parseSnippet(snippet)).toEqual([
      { text: "rates set out in Annex I, and each ", highlighted: false },
      { text: "duty", highlighted: true },
    ]);
  });

  it("handles a snippet that is entirely one highlighted match", () => {
    expect(parseSnippet("[[hl]]tariff[[/hl]]")).toEqual([
      { text: "tariff", highlighted: true },
    ]);
  });

  it("handles adjacent highlights with no plain text between them", () => {
    expect(parseSnippet("[[hl]]a[[/hl]][[hl]]b[[/hl]]")).toEqual([
      { text: "a", highlighted: true },
      { text: "b", highlighted: true },
    ]);
  });

  describe("malformed input", () => {
    it("highlights through to the end of the string for an unclosed opener", () => {
      // No [[/hl]] ever arrives, so the safest reading is that everything
      // after the opener was meant to be highlighted -- see the function's
      // doc comment for why this beats dropping the match entirely.
      const result = parseSnippet("before [[hl]]tariff rates with no close");
      expect(result).toEqual([
        { text: "before ", highlighted: false },
        { text: "tariff rates with no close", highlighted: true },
      ]);
    });

    it("never throws on an unclosed opener, and preserves every character", () => {
      expect(() => parseSnippet("[[hl]]dangling")).not.toThrow();
      const result = parseSnippet("[[hl]]dangling");
      expect(result.map((segment) => segment.text).join("")).toBe("dangling");
    });

    it("drops a stray closer with no opener rather than showing it as text", () => {
      const result = parseSnippet("before[[/hl]] after");
      expect(result.every((segment) => !segment.highlighted)).toBe(true);
      expect(result.map((segment) => segment.text).join("")).toBe(
        "before after",
      );
      for (const segment of result) {
        expect(segment.text).not.toContain(HIGHLIGHT_CLOSE);
      }
    });

    it("never throws on a stray closer with no opener", () => {
      expect(() => parseSnippet("[[/hl]]no opener at all")).not.toThrow();
      expect(parseSnippet("[[/hl]]no opener at all")).toEqual([
        { text: "no opener at all", highlighted: false },
      ]);
    });

    it("treats a duplicate opener while already highlighted as a no-op", () => {
      // "[[hl]]a[[hl]]b[[/hl]]c[[/hl]]" -- the second [[hl]] does not restart
      // or nest a highlight, it just has no effect; the words are unaffected.
      const result = parseSnippet("[[hl]]a[[hl]]b[[/hl]]c[[/hl]]");
      expect(result).toEqual([
        { text: "a", highlighted: true },
        { text: "b", highlighted: true },
        { text: "c", highlighted: false },
      ]);
    });

    it("treats a duplicate closer while not highlighted as a no-op", () => {
      const result = parseSnippet("[[hl]]a[[/hl]][[/hl]]b");
      expect(result).toEqual([
        { text: "a", highlighted: true },
        { text: "b", highlighted: false },
      ]);
    });

    it("never throws and preserves all text across a mix of malformed markers", () => {
      const snippet =
        "[[/hl]]stray close, then [[hl]]a real [[hl]]nested[[/hl]] highlight[[/hl]] and an [[hl]]unclosed tail";
      expect(() => parseSnippet(snippet)).not.toThrow();
      const result = parseSnippet(snippet);
      expect(result.map((segment) => segment.text).join("")).toBe(
        "stray close, then a real nested highlight and an unclosed tail",
      );
    });
  });

  it("exports the marker constants so nothing else hardcodes them", () => {
    expect(HIGHLIGHT_OPEN).toBe("[[hl]]");
    expect(HIGHLIGHT_CLOSE).toBe("[[/hl]]");
  });
});
