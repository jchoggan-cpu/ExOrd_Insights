import { describe, expect, it } from "vitest";
import { checkDateSanity } from "@/lib/federal-register/date-sanity";

const TODAY = new Date("2026-09-08T00:00:00Z");

describe("checkDateSanity", () => {
  it("returns null for an ordinary, sane date", () => {
    expect(checkDateSanity({ date_signed: "2025-09-29", date_published: "2025-10-01" }, TODAY)).toBeNull();
  });

  it("flags a date_signed in the future — the EO 14353 bug", () => {
    const reason = checkDateSanity({ date_signed: "2029-09-29", date_published: null }, TODAY);
    expect(reason).toContain("2029-09-29");
    expect(reason).toContain("future");
  });

  it("flags a date_signed before the administration's start date with no date_published to explain it", () => {
    const reason = checkDateSanity({ date_signed: "2025-01-19", date_published: null }, TODAY);
    expect(reason).toContain("2025-01-19");
    expect(reason).toContain("administration");
  });

  it("still flags the real bug this was written for: a memorandum with date_signed 2025-01-18 (true date 2025-02-18) that never made it into the Federal Register at all", () => {
    const reason = checkDateSanity({ date_signed: "2025-01-18", date_published: null }, TODAY);
    expect(reason).toContain("2025-01-18");
    expect(reason).toContain("administration");
    expect(reason).toContain("missing");
  });

  it("still flags a pre-start date_signed whose date_published is also pre-start (no publication to explain it away)", () => {
    const reason = checkDateSanity({ date_signed: "2025-01-17", date_published: "2025-01-18" }, TODAY);
    expect(reason).toContain("2025-01-17");
    expect(reason).toContain("administration");
  });

  it("does NOT flag a genuine prior-administration holdover — signed before the start date, but published after it (the EO 14145/14146 pattern)", () => {
    expect(checkDateSanity({ date_signed: "2025-01-19", date_published: "2025-01-24" }, TODAY)).toBeNull();
  });

  it("does NOT flag a holdover published exactly on the start date", () => {
    expect(checkDateSanity({ date_signed: "2025-01-17", date_published: "2025-01-20" }, TODAY)).toBeNull();
  });

  it("allows date_signed exactly on the administration's start date", () => {
    expect(checkDateSanity({ date_signed: "2025-01-20", date_published: null }, TODAY)).toBeNull();
  });

  it("flags date_published earlier than date_signed", () => {
    const reason = checkDateSanity({ date_signed: "2025-09-29", date_published: "2025-09-20" }, TODAY);
    expect(reason).toContain("date_published");
  });

  it("allows date_published equal to date_signed (same-day publication)", () => {
    expect(checkDateSanity({ date_signed: "2025-09-29", date_published: "2025-09-29" }, TODAY)).toBeNull();
  });

  it("returns null when dates are entirely absent", () => {
    expect(checkDateSanity({ date_signed: null, date_published: null }, TODAY)).toBeNull();
  });
});
