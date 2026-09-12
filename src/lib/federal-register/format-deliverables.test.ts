import { describe, expect, it } from "vitest";
import { formatDeliverables, NO_DELIVERABLES_TEXT } from "@/lib/federal-register/format-deliverables";

describe("formatDeliverables", () => {
  it("renders 'None.' when the instrument obliges no outside party", () => {
    expect(formatDeliverables(null)).toBe(NO_DELIVERABLES_TEXT);
    expect(formatDeliverables([])).toBe(NO_DELIVERABLES_TEXT);
  });

  it("renders one obligation in the firm's party-action-deadline shape", () => {
    const text = formatDeliverables([
      {
        action: "submit a plan for the establishment of a sovereign wealth fund",
        deadline: "90 days",
        responsibleParty: "Secretaries of the Treasury and Commerce",
      },
    ]);

    expect(text).toBe(
      "Secretaries of the Treasury and Commerce to submit a plan for the establishment of a sovereign wealth fund (90 days).",
    );
  });

  it("does not double the period when the action already ends in one", () => {
    const text = formatDeliverables([
      { action: "file an annual certification.", deadline: "30 days", responsibleParty: "Contractors" },
    ]);

    expect(text).toBe("Contractors to file an annual certification (30 days).");
    expect(text).not.toContain("..");
  });

  it("puts each obligation on its own line", () => {
    const text = formatDeliverables([
      { action: "pay the new tariff rate", deadline: "immediate", responsibleParty: "Importers" },
      { action: "register with the Department of Commerce", deadline: "unclear", responsibleParty: "Sponsors" },
    ]);

    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("(unclear).");
  });
});
