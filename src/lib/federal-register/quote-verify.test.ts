import { describe, expect, it } from "vitest";
import { findUnverifiedQuotes } from "@/lib/federal-register/quote-verify";

const SOURCE = 'Section 1. National Emergency. As President of the United States, my highest duty is protecting the national security.';

describe("findUnverifiedQuotes", () => {
  it("returns nothing when every quote appears verbatim in the source", () => {
    const draft = 'The order states that "my highest duty is protecting the national security."';
    expect(findUnverifiedQuotes(draft, SOURCE)).toEqual([]);
  });

  it("flags a quote that does not appear in the source", () => {
    const draft = 'The order states that "the president must act immediately."';
    expect(findUnverifiedQuotes(draft, SOURCE)).toEqual(["the president must act immediately."]);
  });

  it("tolerates whitespace and curly-quote differences", () => {
    const draft = 'The order says “my   highest\nduty is protecting the national security”.';
    expect(findUnverifiedQuotes(draft, SOURCE)).toEqual([]);
  });

  it("ignores short quoted fragments below the minimum length", () => {
    const draft = 'It uses the phrase "the".';
    expect(findUnverifiedQuotes(draft, SOURCE)).toEqual([]);
  });

  it("checks each quote independently, flagging only the unverified one", () => {
    const draft =
      'The order says "my highest duty is protecting the national security" but also claims "this was unanimously supported."';
    expect(findUnverifiedQuotes(draft, SOURCE)).toEqual(["this was unanimously supported."]);
  });
});
