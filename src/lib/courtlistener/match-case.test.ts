import { describe, expect, it } from "vitest";
import { matchChallengeToDocket } from "@/lib/courtlistener/match-case";
import type { CourtListenerDocket } from "@/lib/courtlistener/types";

function docket(overrides: Partial<CourtListenerDocket> = {}): CourtListenerDocket {
  return {
    caseName: "Doe v. Noem",
    court_id: "mad",
    court_citation_string: "D. Mass.",
    docketNumber: "1:25-cv-11037",
    dateFiled: "2025-04-21",
    dateTerminated: null,
    docket_absolute_url: "/docket/69918650/doe-v-noem/",
    docket_id: 69918650,
    assignedTo: null,
    ...overrides,
  };
}

describe("matchChallengeToDocket", () => {
  // The clean case, taken from the live data: one exact name match in the
  // court the firm recorded.
  it("is confident about a sole exact name match in the recorded court", () => {
    const real = docket({
      caseName: "CENTRO DE TRABAJADORES UNIDOS v. BESSENT",
      court_id: "dcd",
      court_citation_string: "D.D.C.",
      docketNumber: "1:25-cv-00677",
      dateFiled: "2025-03-07",
    });
    const result = matchChallengeToDocket(
      { caseName: "Centro de Trabajadores Unidos v. Bessent", court: "D.D.C.", orderDateSigned: "2025-01-20" },
      { dockets: [real], truncated: false },
    );
    expect(result.outcome).toBe("confident");
    expect(result.docket).toBe(real);
  });

  // The live data really does contain two distinct "Doe v. Noem" dockets in
  // D. Mass.; filtering by court does not separate them, so a human must.
  it("refuses to choose between two identically-named dockets in the same court", () => {
    const result = matchChallengeToDocket(
      { caseName: "Doe v. Noem", court: "D. Mass.", orderDateSigned: "2025-01-20" },
      { dockets: [docket({ docketNumber: "1:25-cv-11037" }), docket({ docketNumber: "1:25-cv-10904", dateFiled: "2025-04-11" })], truncated: false },
    );
    expect(result.outcome).toBe("ambiguous");
    expect(result.docket).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });

  it("reports not_found when no docket in that court carries the name", () => {
    const result = matchChallengeToDocket(
      { caseName: "Las Americas Immigrant Advocacy Center v. DHS", court: "D.D.C.", orderDateSigned: "2025-01-20" },
      { dockets: [], truncated: false },
    );
    expect(result.outcome).toBe("not_found");
    expect(result.docket).toBeUndefined();
  });

  it("never confirms a match when the court is missing, however clean the name match", () => {
    const result = matchChallengeToDocket({ caseName: "Doe v. Noem", court: "", orderDateSigned: "2025-01-20" }, { dockets: [docket()], truncated: false });
    expect(result.outcome).toBe("ambiguous");
    expect(result.reason).toContain("no court was recorded");
  });

  it("never confirms a match when the court isn't one CourtListener recognizes", () => {
    const result = matchChallengeToDocket(
      { caseName: "Doe v. Noem", court: "Supreme Court of Narnia", orderDateSigned: "2025-01-20" },
      { dockets: [docket()], truncated: false },
    );
    expect(result.outcome).toBe("ambiguous");
    expect(result.reason).toContain("Narnia");
  });

  // A criminal prosecution citing an EO is not a challenge to it — observed
  // polluting a real EO-number search (United States v. Aguilar Lara).
  it("excludes criminal dockets outright", () => {
    const result = matchChallengeToDocket(
      { caseName: "United States v. Aguilar Lara", court: "N.D. Okla.", orderDateSigned: "2025-01-20" },
      { dockets: [docket({ caseName: "United States v. Aguilar Lara", court_id: "oknd", docketNumber: "4:25-cr-00464" })], truncated: false },
    );
    expect(result.outcome).toBe("not_found");
  });

  it("excludes a docket filed well before the order it supposedly challenges", () => {
    const result = matchChallengeToDocket(
      { caseName: "Doe v. Noem", court: "D. Mass.", orderDateSigned: "2025-06-01" },
      { dockets: [docket({ dateFiled: "2023-07-28" })], truncated: false },
    );
    expect(result.outcome).toBe("not_found");
  });

  it("keeps a docket filed just before the order, for suits amended to add it", () => {
    const result = matchChallengeToDocket(
      { caseName: "Doe v. Noem", court: "D. Mass.", orderDateSigned: "2025-05-01" },
      { dockets: [docket({ dateFiled: "2025-04-21" })], truncated: false },
    );
    expect(result.outcome).toBe("confident");
  });

  it("treats a similar-but-not-exact caption as ambiguous, never as a match", () => {
    const result = matchChallengeToDocket(
      { caseName: "Las Americas Immigrant Advocacy Center v. Noem", court: "D.D.C.", orderDateSigned: "2025-01-20" },
      {
        dockets: [
          docket({
            caseName: "Las Americas Immigrant Advocacy Center Inc v. Noem",
            court_id: "dcd",
            court_citation_string: "D.D.C.",
            dateFiled: "2025-02-12",
          }),
        ],
        truncated: false,
      },
    );
    expect(result.outcome).toBe("ambiguous");
    expect(result.candidates).toHaveLength(1);
  });

  it("reports not_found for an entry with no case name at all", () => {
    const result = matchChallengeToDocket({ caseName: "", court: "D.D.C." }, { dockets: [docket()], truncated: false });
    expect(result.outcome).toBe("not_found");
  });

  // "Sole result" is a claim about the whole result set, and CourtListener
  // pages at 20 — so a truncated page can't support it.
  it("refuses to confirm a sole match when more pages of results exist", () => {
    const result = matchChallengeToDocket(
      { caseName: "Doe v. Noem", court: "D. Mass.", orderDateSigned: "2025-01-20" },
      { dockets: [docket()], truncated: true },
    );
    expect(result.outcome).toBe("ambiguous");
    expect(result.reason).toContain("more pages");
  });

  it("refuses to confirm a docket that has no filing date to check", () => {
    const result = matchChallengeToDocket(
      { caseName: "Doe v. Noem", court: "D. Mass.", orderDateSigned: "2025-01-20" },
      { dockets: [docket({ dateFiled: null })], truncated: false },
    );
    expect(result.outcome).toBe("ambiguous");
    expect(result.reason).toContain("no filing date");
  });
});
