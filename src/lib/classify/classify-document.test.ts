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

describe("parseClassifyResponse — practice subgroups", () => {
  const SUBGROUP = "Governmental--National Security";

  it("accepts a subgroup tag", () => {
    const result = parseClassifyResponse(JSON.stringify({ practiceAreas: [SUBGROUP], industries: [] }));
    expect(result.practiceAreas).toEqual([SUBGROUP]);
  });

  it("drops the bare parent when a subgroup of it is also present", () => {
    // "Governmental" alongside "Governmental--National Security" says nothing
    // the subgroup doesn't, and would match a parent filter twice.
    const result = parseClassifyResponse(
      JSON.stringify({ practiceAreas: ["Governmental", SUBGROUP], industries: [] }),
    );
    expect(result.practiceAreas).toEqual([SUBGROUP]);
  });

  it("keeps a bare parent when no subgroup of it was chosen", () => {
    const result = parseClassifyResponse(JSON.stringify({ practiceAreas: ["Governmental"], industries: [] }));
    expect(result.practiceAreas).toEqual(["Governmental"]);
  });

  it("keeps two subgroups of the same parent", () => {
    const both = [SUBGROUP, "Governmental--International Trade"];
    const result = parseClassifyResponse(JSON.stringify({ practiceAreas: both, industries: [] }));
    expect(result.practiceAreas).toEqual(both);
  });

  it("drops an invented subgroup of a real parent", () => {
    const result = parseClassifyResponse(
      JSON.stringify({ practiceAreas: ["Governmental--Space Law"], industries: [] }),
    );
    expect(result.practiceAreas).toEqual([]);
  });

  it("drops a subgroup of a parent that declares none", () => {
    const result = parseClassifyResponse(JSON.stringify({ practiceAreas: ["Tax--Customs"], industries: [] }));
    expect(result.practiceAreas).toEqual([]);
  });

  it("does not drop an unrelated area that merely shares a prefix word", () => {
    const tags = ["Governmental--National Security", "Global Reach"];
    const result = parseClassifyResponse(JSON.stringify({ practiceAreas: tags, industries: [] }));
    expect(result.practiceAreas).toEqual(tags);
  });
});

describe("parseClassifyResponse — practices that are also subgroups", () => {
  // Sheppard lists Antitrust and White Collar both in their own right and
  // inside Governmental. A row carrying both says the same thing twice.
  it("keeps the subgroup and drops the standalone when both are returned", () => {
    const result = parseClassifyResponse(
      JSON.stringify({
        practiceAreas: ["Antitrust and Competition", "Governmental--Antitrust and Competition"],
        industries: [],
      }),
    );
    expect(result.practiceAreas).toEqual(["Governmental--Antitrust and Competition"]);
  });

  it("matches across the & / and spelling difference", () => {
    // The standalone is "White Collar Defense and Investigations"; the
    // subgroup is "...Defense & Investigations".
    const result = parseClassifyResponse(
      JSON.stringify({
        practiceAreas: [
          "White Collar Defense and Investigations",
          "Governmental--White Collar Defense & Investigations",
        ],
        industries: [],
      }),
    );
    expect(result.practiceAreas).toEqual(["Governmental--White Collar Defense & Investigations"]);
  });

  it("keeps the standalone when no subgroup version was returned", () => {
    const result = parseClassifyResponse(
      JSON.stringify({ practiceAreas: ["Antitrust and Competition"], industries: [] }),
    );
    expect(result.practiceAreas).toEqual(["Antitrust and Competition"]);
  });

  it("leaves unrelated areas alone", () => {
    const tags = ["Global Reach", "Governmental--International Trade"];
    const result = parseClassifyResponse(JSON.stringify({ practiceAreas: tags, industries: [] }));
    expect(result.practiceAreas).toEqual(tags);
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

function fakeClient(text: string, stopReason = "end_turn") {
  // Typed through the generic rather than an unused parameter, so the call
  // arguments stay inspectable without tripping no-unused-vars.
  const create = vi.fn<(params: SentMessage) => Promise<FakeResponse>>(async () => ({
    content: [{ type: "text", text }],
    stop_reason: stopReason,
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
  // Four of 614 rows hit this on the real run. The cut landed mid-object, so
  // it surfaced as "not valid JSON" and sent the diagnosis the wrong way;
  // the ceiling is checked first now so the error names the real cause.
  it("reports a truncated response as truncation, not as bad JSON", async () => {
    const { client } = fakeClient('{"practiceAreas": ["Gov', "max_tokens");

    await expect(
      classifyDocument({
        client,
        model: "test-model",
        systemPrompt: "SYSTEM",
        input: { title: "An Order", actionType: "Executive Order", sourceText: "BODY", sourceIsSummary: false },
      }),
    ).rejects.toThrow("cut off");
  });
});

