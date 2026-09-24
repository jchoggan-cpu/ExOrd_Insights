import { describe, expect, it } from "vitest";
import {
  addSessionDraft,
  deleteTokenFor,
  parseSessionDrafts,
  removeSessionDraft,
  serializeSessionDrafts,
  type SessionDraft,
} from "@/lib/session-drafts";

const A: SessionDraft = { id: "draft-a", deleteToken: "token-a" };
const B: SessionDraft = { id: "draft-b", deleteToken: "token-b" };

describe("parseSessionDrafts", () => {
  it("round-trips what this session stored", () => {
    expect(parseSessionDrafts(serializeSessionDrafts([A, B]))).toEqual([A, B]);
  });

  it("treats nothing stored as nothing created", () => {
    expect(parseSessionDrafts(null)).toEqual([]);
    expect(parseSessionDrafts("")).toEqual([]);
  });

  it("recovers from anything else rather than throwing", () => {
    // Editable by hand, and it survives a deploy that changed the format.
    for (const junk of ["not json", "{}", '"a"', "42", "[1,2,3]"]) {
      expect(parseSessionDrafts(junk)).toEqual([]);
    }
  });

  it("drops entries missing an id or a token", () => {
    // A draft with no token is useless -- it would show a delete button that
    // the server refuses.
    const raw = JSON.stringify([A, { id: "no-token" }, { deleteToken: "no-id" }, { id: "", deleteToken: "x" }]);
    expect(parseSessionDrafts(raw)).toEqual([A]);
  });

  it("de-duplicates by id", () => {
    const raw = JSON.stringify([A, { id: "draft-a", deleteToken: "stale" }]);
    expect(parseSessionDrafts(raw)).toEqual([A]);
  });
});

describe("addSessionDraft", () => {
  it("appends a newly created draft", () => {
    expect(addSessionDraft([A], B)).toEqual([A, B]);
  });

  it("replaces rather than duplicating when the same id comes back", () => {
    expect(addSessionDraft([A], { id: "draft-a", deleteToken: "fresher" })).toEqual([
      { id: "draft-a", deleteToken: "fresher" },
    ]);
  });

  it("does not mutate what it was given", () => {
    const original = [A];
    addSessionDraft(original, B);
    expect(original).toEqual([A]);
  });
});

describe("removeSessionDraft and deleteTokenFor", () => {
  it("forgets a draft once it is deleted", () => {
    expect(removeSessionDraft([A, B], "draft-a")).toEqual([B]);
  });

  it("is unbothered by an id it does not hold", () => {
    expect(removeSessionDraft([A], "nope")).toEqual([A]);
  });

  it("returns a token only for a draft this session created", () => {
    expect(deleteTokenFor([A, B], "draft-b")).toBe("token-b");
    // Somebody else's draft, seen in the shared list: no token, no delete.
    expect(deleteTokenFor([A, B], "someone-elses")).toBeNull();
  });
});
