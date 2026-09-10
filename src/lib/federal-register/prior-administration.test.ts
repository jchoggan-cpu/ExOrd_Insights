import { describe, expect, it } from "vitest";
import { isPriorAdministrationHoldover } from "@/lib/federal-register/prior-administration";

describe("isPriorAdministrationHoldover", () => {
  it("flags a date signed before the administration's start date", () => {
    expect(isPriorAdministrationHoldover("2025-01-19")).toBe(true);
  });

  it("does not flag a date signed exactly on the start date", () => {
    expect(isPriorAdministrationHoldover("2025-01-20")).toBe(false);
  });

  it("does not flag a date signed after the start date", () => {
    expect(isPriorAdministrationHoldover("2025-09-29")).toBe(false);
  });

  it("does not flag a null date_signed", () => {
    expect(isPriorAdministrationHoldover(null)).toBe(false);
  });

  it("does not flag an undefined date_signed", () => {
    expect(isPriorAdministrationHoldover(undefined)).toBe(false);
  });
});
