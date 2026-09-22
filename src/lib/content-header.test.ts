import { describe, expect, it } from "vitest";
import {
  assembleDraft,
  buildContentHeader,
  fallbackTitle,
  orderLabel,
  splitTitleFromDraft,
} from "@/lib/content-header";
import type { ExecutiveOrder } from "@/lib/types";

function order(overrides: Partial<ExecutiveOrder> = {}): ExecutiveOrder {
  return {
    id: "row-1",
    eoNumber: "EO 14259",
    actionType: "Executive Order",
    title: "Amendment to Reciprocal Tariffs",
    dateSigned: "2025-04-08",
    status: "active",
    subjectArea: ["Trade"],
    practiceAreas: [],
    industries: [],
    agenciesImpacted: [],
    keyDates: [],
    legalChallenges: [],
    newsMentions: [],
    manuallyEditedFields: [],
    appliedCorrectionDocumentNumbers: [],
    needsReview: false,
    federalRegisterUrl: "https://www.federalregister.gov/documents/2025/04/08/eo-14259",
    ...overrides,
  } as ExecutiveOrder;
}

describe("orderLabel", () => {
  it("uses the EO number when there is one", () => {
    expect(orderLabel(order())).toBe("EO 14259");
  });

  it("falls back to the subject when there is no number", () => {
    // Proclamations and memoranda never carry an EO number.
    expect(orderLabel(order({ eoNumber: undefined, subjectArea: ["Trade"] }))).toBe("Trade");
  });

  it("falls back to the action type when there is neither", () => {
    expect(orderLabel(order({ eoNumber: undefined, subjectArea: [] }))).toBe("Executive Order");
  });
});

describe("buildContentHeader", () => {
  it("names the piece and the kind of piece it is", () => {
    const header = buildContentHeader([order()], "blog_post", "Tariffs Rise Again");
    expect(header.split("\n")[0]).toBe("# Tariffs Rise Again (Blog Post)");
  });

  it("links each order to its source", () => {
    const header = buildContentHeader([order()], "client_alert", "T");
    expect(header).toContain(
      "- [EO 14259 — Amendment to Reciprocal Tariffs](https://www.federalregister.gov/documents/2025/04/08/eo-14259)",
    );
  });

  it("says so rather than inventing a link when there is no source URL", () => {
    // 54 legacy rows have no Federal Register record at all.
    const header = buildContentHeader([order({ federalRegisterUrl: undefined })], "blog_post", "T");
    expect(header).toContain("(no source link on file)");
    expect(header).not.toContain("http");
  });

  it("lists every order, and pluralizes the label", () => {
    const header = buildContentHeader(
      [order(), order({ id: "row-2", eoNumber: "EO 14260", title: "Second Order" })],
      "talking_points",
      "Two Things",
    );
    expect(header).toContain("**Executive orders covered:**");
    expect(header).toContain("EO 14259");
    expect(header).toContain("EO 14260");
    expect(buildContentHeader([order()], "blog_post", "T")).toContain("**Executive order covered:**");
  });
});

describe("splitTitleFromDraft", () => {
  it("takes the first line as the title and the rest as the body", () => {
    const { title, body } = splitTitleFromDraft("Tariffs Rise Again\n\nThe order does things.");
    expect(title).toBe("Tariffs Rise Again");
    expect(body).toBe("The order does things.");
  });

  it("strips markdown the model added despite being asked not to", () => {
    expect(splitTitleFromDraft("## Tariffs Rise Again\n\nBody").title).toBe("Tariffs Rise Again");
    expect(splitTitleFromDraft("**Tariffs Rise Again**\n\nBody").title).toBe("Tariffs Rise Again");
  });

  it("keeps the draft intact when the first line is prose, not a title", () => {
    // A model that ignored the instruction should lose its header, not its
    // opening paragraph.
    const prose =
      "On April 8, 2025 the President issued an order amending the reciprocal tariff rates that had been set earlier that year, raising them substantially for low-value imports.";
    const { title, body } = splitTitleFromDraft(prose);
    expect(title).toBeNull();
    expect(body).toBe(prose);
  });

  it("handles leading blank lines and an empty draft", () => {
    expect(splitTitleFromDraft("\n\nTitle Here\n\nBody").title).toBe("Title Here");
    expect(splitTitleFromDraft("").title).toBeNull();
    expect(splitTitleFromDraft("   \n  ").title).toBeNull();
  });
});

describe("assembleDraft", () => {
  it("puts the header above the body", () => {
    const result = assembleDraft([order()], "blog_post", "Tariffs Rise Again\n\nThe body.");
    expect(result.startsWith("# Tariffs Rise Again (Blog Post)")).toBe(true);
    expect(result).toContain("EO 14259");
    expect(result.endsWith("The body.")).toBe(true);
  });

  it("never loses the model's words when it gave no title", () => {
    const prose = "A ".repeat(100) + "long opening paragraph with no title line.";
    const result = assembleDraft([order()], "blog_post", prose);
    expect(result).toContain(prose.trim());
    // Falls back to the order's own title rather than leaving the piece unnamed.
    expect(result.startsWith("# Amendment to Reciprocal Tariffs (Blog Post)")).toBe(true);
  });

  it("names a multi-order piece by its count when the model gave no title", () => {
    expect(fallbackTitle([order(), order({ id: "row-2" })])).toBe("2 executive actions");
  });
});
