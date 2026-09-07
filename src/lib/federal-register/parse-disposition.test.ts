import { describe, expect, it } from "vitest";
import { parseDispositionNotes } from "@/lib/federal-register/parse-disposition";

describe("parseDispositionNotes", () => {
  it("defaults to active with no related orders for null notes", () => {
    expect(parseDispositionNotes(null)).toEqual({ status: "active", relatedEoNumbers: [] });
  });

  it("parses a real 'Revokes in part... See...' note into amended + both related EO numbers", () => {
    // Verbatim from EO 14146 (document 2025-01759), pulled from the live API.
    const notes = "Revokes in part: EO 13961, December 7, 2020\r\nSee: EO 14239, March 18, 2025";

    const result = parseDispositionNotes(notes);

    expect(result.status).toBe("amended");
    expect(result.relatedEoNumbers).toEqual(["EO 13961", "EO 14239"]);
  });

  it("marks a full revocation as revoked", () => {
    const result = parseDispositionNotes("Revokes: EO 13985, January 20, 2021");
    expect(result.status).toBe("revoked");
    expect(result.relatedEoNumbers).toEqual(["EO 13985"]);
  });

  it("does not downgrade revoked to amended if a later line only amends", () => {
    const notes = "Revokes: EO 13985, January 20, 2021\r\nAmends: EO 14000, June 1, 2022";
    expect(parseDispositionNotes(notes).status).toBe("revoked");
  });

  it("falls back safely to active for an unrecognized note format, but still extracts EO numbers", () => {
    const result = parseDispositionNotes("Something unexpected mentioning EO 14000 happened");
    expect(result.status).toBe("active");
    expect(result.relatedEoNumbers).toEqual(["EO 14000"]);
  });
});
