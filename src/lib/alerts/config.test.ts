import { afterEach, describe, expect, it } from "vitest";
import { getSiteUrl, getSlackWebhookUrl } from "@/lib/alerts/config";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getSlackWebhookUrl", () => {
  it("returns a configured webhook URL", () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/xxxx";
    expect(getSlackWebhookUrl()).toBe("https://hooks.slack.com/services/T000/B000/xxxx");
  });

  it("trims surrounding whitespace, the commonest way a pasted value half-works", () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = "  https://hooks.slack.com/services/T000/B000/xxxx  ";
    expect(getSlackWebhookUrl()).toBe("https://hooks.slack.com/services/T000/B000/xxxx");
  });

  it("throws when unset", () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    expect(() => getSlackWebhookUrl()).toThrow(/No alert channel configured/);
  });

  it("throws when set but empty, and says that is what happened", () => {
    // Not hypothetical: a Vercel environment variable can be registered and
    // still hold nothing, which is how an empty ANTHROPIC_API_KEY went
    // unnoticed for eight nights. The message has to distinguish "missing"
    // from "present but blank" or the same hour gets lost again.
    process.env.SLACK_ALERT_WEBHOOK_URL = "   ";
    expect(() => getSlackWebhookUrl()).toThrow(/the stored value is blank/);
  });

  it("throws when the value is not a Slack webhook at all", () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://example.com/hook";
    expect(() => getSlackWebhookUrl()).toThrow(/does not look like a Slack incoming webhook/);
  });

  it("never puts the configured value in the error message", () => {
    // The webhook URL is a credential — anyone holding it can post into
    // the channel. An error that echoed it would leak it into logs.
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://evil.example.com/SUPERSECRETTOKEN";
    expect(() => getSlackWebhookUrl()).toThrow();
    try {
      getSlackWebhookUrl();
    } catch (err) {
      expect((err as Error).message).not.toContain("SUPERSECRETTOKEN");
    }
  });
});

describe("getSiteUrl", () => {
  it("uses the Vercel production URL when deployed", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ex-ord-insights.vercel.app";
    expect(getSiteUrl()).toBe("https://ex-ord-insights.vercel.app");
  });

  it("falls back to localhost rather than failing a real alert over a link", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});
