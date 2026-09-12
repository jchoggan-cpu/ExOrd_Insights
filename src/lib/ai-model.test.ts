import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnthropicClient,
  describeAiProvider,
  getConfiguredModel,
  getSummaryModel,
  hasAiCredentials,
} from "@/lib/ai-model";

const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

/**
 * Every test starts from "nothing configured" and opts in to exactly the
 * variables it cares about — otherwise a real key in the developer's own
 * shell would change which branch is under test.
 */
function configure(vars: Record<string, string | undefined>) {
  for (const name of [
    "AI_GATEWAY_API_KEY",
    "ANTHROPIC_API_KEY",
    "EO_TRACKER_MODEL",
    "EO_TRACKER_SUMMARY_MODEL",
  ]) {
    vi.stubEnv(name, vars[name] ?? "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credential resolution", () => {
  it("reports no credentials when neither key is set", () => {
    configure({});
    expect(hasAiCredentials()).toBe(false);
    expect(describeAiProvider()).toBe("none configured");
    expect(() => createAnthropicClient()).toThrow(/No AI credentials configured/);
  });

  it("routes through the Vercel AI Gateway when AI_GATEWAY_API_KEY is set", () => {
    configure({ AI_GATEWAY_API_KEY: "gateway-key" });

    expect(hasAiCredentials()).toBe(true);
    expect(describeAiProvider()).toBe("Vercel AI Gateway");
    expect(createAnthropicClient().baseURL).toBe(GATEWAY_BASE_URL);
  });

  it("prefers the gateway when both keys are set", () => {
    configure({ AI_GATEWAY_API_KEY: "gateway-key", ANTHROPIC_API_KEY: "anthropic-key" });

    expect(describeAiProvider()).toBe("Vercel AI Gateway");
    expect(createAnthropicClient().apiKey).toBe("gateway-key");
  });

  it("talks to Anthropic directly when only ANTHROPIC_API_KEY is set", () => {
    configure({ ANTHROPIC_API_KEY: "anthropic-key" });

    expect(describeAiProvider()).toBe("Anthropic API (direct)");
    const client = createAnthropicClient();
    expect(client.apiKey).toBe("anthropic-key");
    expect(client.baseURL).not.toBe(GATEWAY_BASE_URL);
  });
});

describe("getConfiguredModel", () => {
  it("defaults to claude-opus-5, bare, on the direct route", () => {
    configure({ ANTHROPIC_API_KEY: "anthropic-key" });
    expect(getConfiguredModel()).toBe("claude-opus-5");
  });

  it("defaults to the provider-prefixed id on the gateway route", () => {
    configure({ AI_GATEWAY_API_KEY: "gateway-key" });
    expect(getConfiguredModel()).toBe("anthropic/claude-opus-5");
  });

  it("adds the prefix to a bare EO_TRACKER_MODEL when using the gateway", () => {
    configure({ AI_GATEWAY_API_KEY: "gateway-key", EO_TRACKER_MODEL: "claude-sonnet-5" });
    expect(getConfiguredModel()).toBe("anthropic/claude-sonnet-5");
  });

  it("does not double-prefix an EO_TRACKER_MODEL that already carries one", () => {
    configure({ AI_GATEWAY_API_KEY: "gateway-key", EO_TRACKER_MODEL: "anthropic/claude-sonnet-5" });
    expect(getConfiguredModel()).toBe("anthropic/claude-sonnet-5");
  });

  it("strips a gateway prefix when talking to Anthropic directly", () => {
    configure({ ANTHROPIC_API_KEY: "anthropic-key", EO_TRACKER_MODEL: "anthropic/claude-sonnet-5" });
    expect(getConfiguredModel()).toBe("claude-sonnet-5");
  });
});

describe("getSummaryModel", () => {
  it("defaults to Fable 5, independently of the content-drafting model", () => {
    configure({ ANTHROPIC_API_KEY: "anthropic-key" });

    expect(getSummaryModel()).toBe("claude-fable-5");
    // Summarization and drafting are priced and tuned separately — one must
    // not silently follow the other.
    expect(getConfiguredModel()).toBe("claude-opus-5");
  });

  it("is not affected by EO_TRACKER_MODEL, which governs drafting only", () => {
    configure({ ANTHROPIC_API_KEY: "anthropic-key", EO_TRACKER_MODEL: "claude-haiku-4-5" });

    expect(getConfiguredModel()).toBe("claude-haiku-4-5");
    expect(getSummaryModel()).toBe("claude-fable-5");
  });

  it("honors EO_TRACKER_SUMMARY_MODEL", () => {
    configure({ ANTHROPIC_API_KEY: "anthropic-key", EO_TRACKER_SUMMARY_MODEL: "claude-sonnet-5" });

    expect(getSummaryModel()).toBe("claude-sonnet-5");
  });

  it("prefixes the summary model for the gateway route too", () => {
    configure({ AI_GATEWAY_API_KEY: "gateway-key" });

    expect(getSummaryModel()).toBe("anthropic/claude-fable-5");
  });
});
