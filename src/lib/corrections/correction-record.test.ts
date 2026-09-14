import { describe, expect, it } from "vitest";
import {
  buildCorrectionRecord,
  buildCorrectionUpdate,
  isCorrectableField,
  type RecordSubject,
} from "@/lib/corrections/correction-record";

const TODAY = "2026-09-13";

function subject(overrides: Partial<RecordSubject> = {}): RecordSubject {
  return {
    id: "a4d41b35-01d5-4872-84af-84b38e466588",
    eoNumber: "EO 14183",
    title: "Prioritizing Military Excellence and Readiness",
    manuallyEditedFields: ["subjectArea", "aiSummary", "deliverable", "legalChallenges"],
    ...overrides,
  };
}

describe("isCorrectableField", () => {
  it("accepts a known field", () => {
    expect(isCorrectableField("aiSummary")).toBe(true);
  });

  it("rejects an unknown one rather than letting it clear nothing silently", () => {
    expect(isCorrectableField("aiSummry")).toBe(false);
    expect(isCorrectableField("__proto__")).toBe(false);
  });
});

describe("buildCorrectionRecord", () => {
  it("captures the before-state verbatim so the change can be undone", () => {
    const before = "10 days for Secretary of Defense to revise Command Plan.";
    const record = buildCorrectionRecord({
      subject: subject(),
      field: "aiSummary",
      reason: "Summary describes a different document; its terms appear nowhere in this order's full text.",
      before,
      after: null,
      today: TODAY,
    });

    expect(record.before).toBe(before);
    expect(record.after).toBeNull();
    expect(record.eoNumber).toBe("EO 14183");
    expect(record.date).toBe(TODAY);
    expect(record.protectionRemoved).toBe(true);
  });

  it("refuses a correction with no reason", () => {
    expect(() =>
      buildCorrectionRecord({ subject: subject(), field: "aiSummary", reason: "   ", before: "x", after: null, today: TODAY }),
    ).toThrow("needs a reason");
  });

  it("reports protectionRemoved false when the field was never protected", () => {
    const record = buildCorrectionRecord({
      subject: subject({ manuallyEditedFields: ["deliverable"] }),
      field: "aiSummary",
      reason: "wrong",
      before: "x",
      after: null,
      today: TODAY,
    });

    expect(record.protectionRemoved).toBe(false);
  });
});

describe("buildCorrectionUpdate", () => {
  it("maps the field to its database column", () => {
    const update = buildCorrectionUpdate({ subject: subject(), field: "aiSummary", after: null });
    expect(update.ai_summary).toBeNull();
  });

  it("drops only the corrected field's protection, leaving the others", () => {
    // A correction to one field says nothing about whether the firm's other
    // hand-edited fields should be reopened to the pipeline.
    const update = buildCorrectionUpdate({ subject: subject(), field: "aiSummary", after: null });

    expect(update.manually_edited_fields).toEqual(["subjectArea", "deliverable", "legalChallenges"]);
  });

  it("leaves manually_edited_fields alone when the field was not protected", () => {
    const update = buildCorrectionUpdate({
      subject: subject({ manuallyEditedFields: ["deliverable"] }),
      field: "aiSummary",
      after: null,
    });

    expect(update.manually_edited_fields).toEqual(["deliverable"]);
  });
});
