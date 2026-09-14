import { describe, expect, it, vi } from "vitest";
import { classifyDocument, parseClassifyResponse } from "@/lib/classify/classify-document";
import { buildClassifyPrompt } from "@/lib/classify/classify-prompt";
import { INDUSTRIES, PRACTICE_AREA_NAMES } from "@/lib/taxonomy";

const A_PRACTICE_AREA = PRACTICE_AREA_NAMES[0];
const AN_INDUSTRY = INDUSTRIES[0];

/** Wraps JSON the way a model does when it answers in a Markdown code block. */
function fenced(value: unknown, languageTag = "json"): string {
  return ["```" + languageTag, JSON.stringify(value), "```"].join("\n");
}

describe("parseClassifyResponse", () => {
  it("keeps valid tags from the firm's fixed lists", () => {
    const result = parseClassifyResponse(
      JSON.stringify({ practiceAreas: [A_PRACTICE_AREA], industries: [AN_INDUSTRY] }),
    );

    expect(result.practiceAreas).toEqual([A_PRACTICE_AREA]);
    expect(result.industries).toEqual([AN_INDUSTRY]);
  });

  it("drops a tag the model invented", () => {
    // These columns are filtered on, so an invented tag would appear in the
    // UI as a real category matching exactly one row.
    const result = parseClassifyResponse(
      JSON.stringify({ practiceAreas: [A_PRACTICE_AREA, "Maritime Piracy"], industries: [] }),
    );

    expect(result.practiceAreas).toEqual([A_PRACTICE_AREA]);
  });

  it("drops a near-miss name rather than guessing what was meant", () => {
    const result = parseClassifyResponse(JSON.stringify({ practiceAreas: ["white collar"], industries: [] }));
    expect(result.practiceAreas).toEqual([]);
  });

  it("de-duplicates a repeated tag", () => {
    const result = parseClassifyResponse(
      JSON.stringify({ practiceAreas: [A_PRACTICE_AREA, A_PRACTICE_AREA], industries: [] }),
    );

    expect(result.practiceAreas).toEqual([A_PRACTICE_AREA]);
  });

  it("accepts genuinely empty lists", () => {
    expect(parseClassifyResponse(JSON.stringify({ practiceAreas: [], industries: [] }))).toEqual({
      practiceAreas: [],
      industries: [],
    });
  });

  // Measured against the real API: asked for bare JSON, Fable 5 returns it,
  // but Haiku 4.5 reliably wraps it in a fence. The classifier has to accept
  // both or it cannot be moved between models.
  it("accepts JSON wrapped in a markdown code fence", () => {
    const result = parseClassifyResponse(fenced({ practiceAreas: [A_PRACTICE_AREA], industries: [] }));
    expect(result.practiceAreas).toEqual([A_PRACTICE_AREA]);
  });

  it("accepts a fence with no language tag", () => {
    const result = parseClassifyResponse(fenced({ practiceAreas: [], industries: [AN_INDUSTRY] }, ""));
    expect(result.industries).toEqual([AN_INDUSTRY]);
  });

  it("still rejects prose wrapped in a fence", () => {
    const prose = ["```", "I think this is about immigration.", "```"].join("\n");
    expect(() => parseClassifyResponse(prose)).toThrow("not valid JSON");
  });

  // The distinction that matters: a broken response must not be recorded as
  // "this order has no practice areas", which is the exact condition the
  // re-tagging run exists to fix.
  it("throws on malformed JSON rather than reporting no tags", () => {
    expect(() => parseClassifyResponse("not json")).toThrow("not valid JSON");
  });

  it("throws when the arrays are missing entirely", () => {
    expect(() => parseClassifyResponse(JSON.stringify({ summary: "..." }))).toThrow("missing practiceAreas");
  });

  it("throws when the response is a bare string", () => {
    expect(() => parseClassifyResponse(JSON.stringify("Labor and Employment"))).toThrow("unexpected shape");
  });
});

describe("buildClassifyPrompt", () => {
  it("lists every practice area with its criteria", () => {
    const prompt = buildClassifyPrompt();
    for (const name of PRACTICE_AREA_NAMES) {
      expect(prompt).toContain(name);
    }
  });

  it("asks only for tags — never a summary, which would endanger the firm's curated text", () => {
    const prompt = buildClassifyPrompt();
    expect(prompt).toContain('"practiceAreas"');
    expect(prompt).toContain('"industries"');
    expect(prompt).not.toContain('"summary"');
  });
});

interface SentMessage {
  messages: { content: string }[];
  system: { cache_control?: unknown }[];
}

interface FakeResponse {
  content: { type: string; text: string }[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

function fakeClient(text: string) {
  // Typed through the generic rather than an unused parameter, so the call
  // arguments stay inspectable without tripping no-unused-vars.
  const create = vi.fn<(params: SentMessage) => Promise<FakeResponse>>(async () => ({
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 20 },
  }));
  return { client: { messages: { create } } as never, create };
}

describe("classifyDocument", () => {
  it("sends the full text and reports the tags and usage", async () => {
    const { client, create } = fakeClient(JSON.stringify({ practiceAreas: [A_PRACTICE_AREA], industries: [] }));

    const outcome = await classifyDocument({
      client,
      model: "test-model",
      systemPrompt: "SYSTEM",
      input: { title: "An Order", actionType: "Executive Order", sourceText: "BODY", sourceIsSummary: false },
    });

    expect(outcome.result.practiceAreas).toEqual([A_PRACTICE_AREA]);
    expect(outcome.usage.inputTokens).toBe(100);

    const sent = create.mock.calls[0][0];
    expect(sent.messages[0].content).toContain("Full text:");
    expect(sent.messages[0].content).toContain("BODY");
    // Identical on 600+ calls; an uncached prefix roughly doubles the bill.
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("tells the model when it is reading a summary rather than the instrument", async () => {
    // 116 rows have no full text; the model should weigh a summary knowing
    // it is one, rather than being handed it as if it were the order.
    const { client, create } = fakeClient(JSON.stringify({ practiceAreas: [], industries: [] }));

    await classifyDocument({
      client,
      model: "test-model",
      systemPrompt: "SYSTEM",
      input: { title: "An Order", actionType: "Memorandum", sourceText: "SHORT", sourceIsSummary: true },
    });

    const sent = create.mock.calls[0][0];
    expect(sent.messages[0].content).toContain("full text of this instrument is not available");
  });
});
