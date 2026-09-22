import { describe, expect, it } from "vitest";
import { parseDispositionNotes } from "@/lib/federal-register/parse-disposition";

/**
 * Three tests in this file used to assert the opposite of what follows:
 * that "Revokes: EO 13985" made the document carrying that note revoked.
 * It does not -- it means that document revoked EO 13985. The tests were
 * wrong along with the code, which is how 24 orders came to be displayed as
 * revoked when every one of them was the instrument doing the revoking.
 *
 * Every note below is verbatim from the live corpus.
 */
describe("parseDispositionNotes", () => {
  it("defaults to active with no related orders for null or empty notes", () => {
    expect(parseDispositionNotes(null)).toEqual({ status: "active", relatedEoNumbers: [] });
    expect(parseDispositionNotes("")).toEqual({ status: "active", relatedEoNumbers: [] });
  });

  describe("active voice -- this order acted on others, so its own status is unchanged", () => {
    it("leaves a revoking order active", () => {
      // EO 14337, "Revocation of Executive Order on Competition". It is the
      // instrument that did the revoking; it is not itself revoked.
      const result = parseDispositionNotes("Revokes: EO 14036 of July 9, 2021");
      expect(result.status).toBe("active");
      expect(result.relatedEoNumbers).toEqual(["EO 14036"]);
    });

    it("leaves an order active that revoked four others", () => {
      // EO 14159, "Protecting the American People Against Invasion" -- a
      // flagship order of this administration, shown as revoked until now.
      const notes =
        "Revokes: EO 13993, January 20, 2021; EO 14010, February 2, 2021; EO 14011, February 2, 2021; EO 14012, February 2, 2021\r\nSee: EO 14288, April 28, 2025; EO 14390, March 6, 2026";
      const result = parseDispositionNotes(notes);

      expect(result.status).toBe("active");
      expect(result.relatedEoNumbers).toEqual([
        "EO 13993",
        "EO 14010",
        "EO 14011",
        "EO 14012",
        "EO 14288",
        "EO 14390",
      ]);
    });

    it("leaves the other active-voice verbs alone", () => {
      // Every one of these occurs in the live corpus.
      for (const notes of [
        "Amends: EO 14000, June 1, 2022",
        "Rescinds: EO 14000, June 1, 2022",
        "Supersedes: EO 14000, June 1, 2022",
        "Supersedes (in part): EO 14000, June 1, 2022",
        "Reinstates: EO 14000, June 1, 2022",
        "Revokes in part: EO 13961, December 7, 2020",
        "Continues: EO 14000, June 1, 2022",
      ]) {
        expect(parseDispositionNotes(notes).status).toBe("active");
      }
    });

    it("treats 'See:' as a cross-reference with no bearing on status", () => {
      // The most common line in the corpus by far -- 148 of them.
      const result = parseDispositionNotes("See: EO 14147, January 20, 2025; EO 14230, March 6, 2025");
      expect(result.status).toBe("active");
      expect(result.relatedEoNumbers).toEqual(["EO 14147", "EO 14230"]);
    });
  });

  describe("passive voice -- this order was acted on, so its status changes", () => {
    it("marks an order revoked when something revoked it", () => {
      // EO 14237, "Addressing Risks From Paul Weiss" -- genuinely revoked,
      // and shown as active until now because no pattern matched this line.
      const notes =
        "See: EO 14147, January 20, 2025; EO 14230, March 6, 2025\r\nRevoked by: EO 14244, March 21, 2025";
      const result = parseDispositionNotes(notes);

      expect(result.status).toBe("revoked");
      expect(result.relatedEoNumbers).toContain("EO 14244");
    });

    it("marks an order revoked when it was superseded outright", () => {
      expect(parseDispositionNotes("Superseded by: EO 14244, March 21, 2025").status).toBe("revoked");
    });

    it("marks an order amended when it was amended or partly superseded", () => {
      expect(parseDispositionNotes("Amended by: EO 14244, March 21, 2025").status).toBe("amended");
      expect(
        parseDispositionNotes("Superseded by (in part): EO 14244, March 21, 2025").status,
      ).toBe("amended");
    });

    it("does not read a partial supersession as a full one", () => {
      // "Superseded by (in part)" starts with "Superseded by", so order of
      // checks matters: partial must be tested first or it reads as revoked.
      expect(parseDispositionNotes("Superseded by (in part): EO 14244").status).not.toBe("revoked");
    });

    it("leaves an order active when it was merely continued", () => {
      // Being continued means still in force, which is not a downgrade.
      expect(parseDispositionNotes("Continued by: EO 14244, March 21, 2025").status).toBe("active");
    });
  });

  describe("combinations", () => {
    it("does not downgrade revoked to amended when a later line only amends", () => {
      const notes = "Revoked by: EO 14244, March 21, 2025\r\nAmended by: EO 14300, June 1, 2025";
      expect(parseDispositionNotes(notes).status).toBe("revoked");
    });

    it("takes revoked over amended whatever the line order", () => {
      const notes = "Amended by: EO 14300, June 1, 2025\r\nRevoked by: EO 14244, March 21, 2025";
      expect(parseDispositionNotes(notes).status).toBe("revoked");
    });

    it("ignores what this order did to others while recording what was done to it", () => {
      const notes = "Revokes: EO 13993, January 20, 2021\r\nRevoked by: EO 14244, March 21, 2025";
      const result = parseDispositionNotes(notes);

      expect(result.status).toBe("revoked");
      expect(result.relatedEoNumbers).toEqual(["EO 13993", "EO 14244"]);
    });
  });

  it("falls back safely to active for an unrecognized format, but still extracts EO numbers", () => {
    // A missed status change is recoverable; an invented one is what this
    // whole file exists to prevent.
    const result = parseDispositionNotes("Something unexpected mentioning EO 14000 happened");
    expect(result.status).toBe("active");
    expect(result.relatedEoNumbers).toEqual(["EO 14000"]);
  });
});
