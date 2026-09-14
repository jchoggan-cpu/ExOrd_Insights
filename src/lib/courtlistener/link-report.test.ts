import { describe, expect, it, vi } from "vitest";
import {
  applyLinkToChallenge,
  buildLinkPlan,
  summarizeLinkPlan,
  type ChallengeRow,
  type DocketLink,
} from "@/lib/courtlistener/link-report";
import type { CourtListenerDocket } from "@/lib/courtlistener/types";

function docket(overrides: Partial<CourtListenerDocket> = {}): CourtListenerDocket {
  return {
    caseName: "Centro de Trabajadores Unidos v. Bessent",
    court_id: "dcd",
    court_citation_string: "D.D.C.",
    docketNumber: "1:25-cv-00677",
    dateFiled: "2025-03-07",
    dateTerminated: null,
    docket_absolute_url: "/docket/69714586/centro-de-trabajadores-unidos-v-bessent/",
    docket_id: 69714586,
    assignedTo: null,
    ...overrides,
  };
}

function row(overrides: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: "eo-1",
    eoNumber: "EO 14165",
    title: "Securing Our Borders",
    dateSigned: "2025-01-20",
    legalChallenges: [{ caseName: "Centro de Trabajadores Unidos v. Bessent", court: "D.D.C." }],
    ...overrides,
  };
}

describe("buildLinkPlan", () => {
  it("links a confident match and records the full docket URL", async () => {
    const searchDockets = vi.fn(async () => ({ dockets: [docket()], truncated: false }));
    const [decision] = await buildLinkPlan({ rows: [row()], searchDockets });

    expect(decision.outcome).toBe("confident");
    expect(decision.link?.url).toBe(
      "https://www.courtlistener.com/docket/69714586/centro-de-trabajadores-unidos-v-bessent/",
    );
    expect(decision.link?.docketNumber).toBe("1:25-cv-00677");
  });

  it("leaves an ambiguous entry unlinked, with candidates for a human to choose from", async () => {
    const searchDockets = vi.fn(async () => ({
      dockets: [
        docket({ caseName: "Doe v. Noem", court_id: "mad", docketNumber: "1:25-cv-11037", docket_id: 1 }),
        docket({ caseName: "Doe v. Noem", court_id: "mad", docketNumber: "1:25-cv-10904", docket_id: 2 }),
      ],
      truncated: false,
    }));
    const [decision] = await buildLinkPlan({
      rows: [row({ legalChallenges: [{ caseName: "Doe v. Noem", court: "D. Mass." }] })],
      searchDockets,
    });

    expect(decision.outcome).toBe("ambiguous");
    expect(decision.link).toBeNull();
    expect(decision.candidates.map((c) => c.docketNumber)).toEqual(["1:25-cv-11037", "1:25-cv-10904"]);
    expect(decision.chosenDocketId).toBeNull();
  });

  it("searches once for a case that challenges several orders", async () => {
    // 252 stored entries but only ~150 distinct case names in the live data,
    // so the cache is what keeps this polite to a free API.
    const searchDockets = vi.fn(async () => ({ dockets: [docket()], truncated: false }));
    await buildLinkPlan({ rows: [row({ id: "eo-1" }), row({ id: "eo-2" }), row({ id: "eo-3" })], searchDockets });

    expect(searchDockets).toHaveBeenCalledTimes(1);
  });

  it("does not search at all for an entry with no case name", async () => {
    const searchDockets = vi.fn(async () => ({ dockets: [docket()], truncated: false }));
    const [decision] = await buildLinkPlan({
      rows: [row({ legalChallenges: [{ caseName: "", court: "D.D.C." }] })],
      searchDockets,
    });

    expect(searchDockets).not.toHaveBeenCalled();
    expect(decision.outcome).toBe("not_found");
  });

  it("passes the resolved court id to the search, not the firm's raw text", async () => {
    const searchDockets = vi.fn(async () => ({ dockets: [docket()], truncated: false }));
    await buildLinkPlan({ rows: [row({ legalChallenges: [{ caseName: "X v. Y", court: "D.Md" }] })], searchDockets });

    expect(searchDockets).toHaveBeenCalledWith({ caseName: "X v. Y", courtId: "mdd" });
  });

  it("lets a failing search stop the run rather than recording it as not_found", async () => {
    // A rate-limited request and a genuinely missing case mean completely
    // different things; silently conflating them would poison the report.
    const searchDockets = vi.fn(async () => {
      throw new Error("CourtListener search failed (429)");
    });

    await expect(buildLinkPlan({ rows: [row()], searchDockets })).rejects.toThrow("429");
  });
  it("reports each decision as it is reached, so an interrupted run keeps its work", async () => {
    // A full pass takes minutes and can be rate-limited part-way; the CLI
    // relies on this callback to save what it already has.
    const searchDockets = vi
      .fn()
      .mockResolvedValueOnce({ dockets: [docket()], truncated: false })
      .mockRejectedValueOnce(new Error("CourtListener search failed (429)"));
    const seen: string[] = [];

    await expect(
      buildLinkPlan({
        rows: [row({ id: "eo-1" }), row({ id: "eo-2", legalChallenges: [{ caseName: "Other v. Party", court: "D.D.C." }] })],
        searchDockets,
        onDecision: (d) => seen.push(d.caseName),
      }),
    ).rejects.toThrow("429");

    expect(seen).toEqual(["Centro de Trabajadores Unidos v. Bessent"]);
  });
});

describe("summarizeLinkPlan", () => {
  it("counts outcomes and distinct cases linked", async () => {
    const searchDockets = vi.fn(async ({ caseName }: { caseName: string }) => ({
      dockets: caseName === "Centro de Trabajadores Unidos v. Bessent" ? [docket()] : [],
      truncated: false,
    }));
    const decisions = await buildLinkPlan({
      rows: [row({ id: "eo-1" }), row({ id: "eo-2", legalChallenges: [{ caseName: "Ghost v. Nobody", court: "D.D.C." }] })],
      searchDockets,
    });

    expect(summarizeLinkPlan(decisions)).toEqual({
      total: 2,
      confident: 1,
      ambiguous: 0,
      notFound: 1,
      distinctCasesLinked: 1,
    });
  });
});

describe("applyLinkToChallenge", () => {
  const link: DocketLink = {
    docketId: 1,
    caseName: "A v. B",
    court: "D.D.C.",
    docketNumber: "1:25-cv-00677",
    dateFiled: "2025-03-07",
    dateTerminated: null,
    url: "https://www.courtlistener.com/docket/1/a-v-b/",
  };

  it("adds the docket fields and a provenance stamp, preserving what the firm wrote", () => {
    const result = applyLinkToChallenge({ caseName: "A v. B", court: "D.D.C.", status: "See summary" }, link);

    expect(result.status).toBe("See summary");
    expect(result.docketUrl).toBe(link.url);
    expect(result.docketNumber).toBe("1:25-cv-00677");
    expect(result.linkSource).toBe("courtlistener");
  });

  it("never overwrites a docketUrl that is already there", () => {
    const existing = { caseName: "A v. B", docketUrl: "https://example.com/hand-entered" };
    expect(applyLinkToChallenge(existing, link)).toEqual(existing);
  });
});

describe("buildLinkPlan — agency abbreviation fallback", () => {
  const abbreviated = row({
    legalChallenges: [{ caseName: "FBI Agents Association et al v. DOJ", court: "D.D.C." }],
  });

  const realDocket = docket({
    caseName: "FEDERAL BUREAU OF INVESTIGATION AGENTS ASSOCIATION v. DEPARTMENT OF JUSTICE",
    court_id: "dcd",
    court_citation_string: "D.D.C.",
    docketNumber: "1:25-cv-00328",
    dateFiled: "2025-02-04",
    docket_id: 12345,
  });

  it("finds a case the firm recorded with acronyms, and never links it automatically", async () => {
    // Verified against the live API: the firm's spelling returns nothing,
    // the expanded spelling returns the real docket.
    const searchDockets = vi.fn(async ({ caseName }: { caseName: string }) => ({
      dockets: caseName.includes("FEDERAL BUREAU") || caseName.includes("Federal Bureau") ? [realDocket] : [],
      truncated: false,
    }));

    const [decision] = await buildLinkPlan({ rows: [abbreviated], searchDockets });

    // Ambiguous, not confident: expanding "DOJ" is an inference about what
    // the firm meant, so a human confirms it.
    expect(decision.outcome).toBe("ambiguous");
    expect(decision.link).toBeNull();
    expect(decision.candidates.map((c) => c.docketNumber)).toContain("1:25-cv-00328");
    expect(decision.reason).toContain("abbreviated");
  });

  it("leaves the recorded case name untouched in the decision", async () => {
    const searchDockets = vi.fn(async ({ caseName }: { caseName: string }) => ({
      dockets: caseName.includes("Federal Bureau") ? [realDocket] : [],
      truncated: false,
    }));

    const [decision] = await buildLinkPlan({ rows: [abbreviated], searchDockets });

    expect(decision.caseName).toBe("FBI Agents Association et al v. DOJ");
  });

  it("stays not_found when no expansion matches either", async () => {
    const searchDockets = vi.fn(async () => ({ dockets: [], truncated: false }));

    const [decision] = await buildLinkPlan({ rows: [abbreviated], searchDockets });

    expect(decision.outcome).toBe("not_found");
  });

  it("does not search expansions for a name with no abbreviations in it", async () => {
    // "Doe v. Noem" must not be read as Department of Energy, and a name
    // with nothing to expand should cost exactly one search.
    const searchDockets = vi.fn(async () => ({ dockets: [], truncated: false }));

    await buildLinkPlan({
      rows: [row({ legalChallenges: [{ caseName: "Doe v. Noem", court: "D. Mass." }] })],
      searchDockets,
    });

    expect(searchDockets).toHaveBeenCalledTimes(1);
  });

  it("does not try expansions when the name as written already matched", async () => {
    const searchDockets = vi.fn(async () => ({ dockets: [docket()], truncated: false }));

    await buildLinkPlan({ rows: [row()], searchDockets });

    expect(searchDockets).toHaveBeenCalledTimes(1);
  });
});
