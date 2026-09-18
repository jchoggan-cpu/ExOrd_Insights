import { describe, expect, it, vi } from "vitest";
import { sendSlackAlert } from "@/lib/alerts/send-slack-alert";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxx";

function fakeFetch(response: { status: number; body: string }) {
  return vi.fn(async () =>
    new Response(response.body, { status: response.status }),
  ) as unknown as typeof fetch;
}

describe("sendSlackAlert", () => {
  it("posts the message as JSON and reports delivery", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: "ok" });

    const result = await sendSlackAlert({ webhookUrl: WEBHOOK, text: "something broke" }, fetchImpl);

    expect(result.delivered).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "something broke" });
  });

  it("reports a revoked webhook rather than pretending it delivered", async () => {
    // Slack answers a deleted or mistyped webhook with 404 no_service.
    // Flattening that to "failed" would lose the one detail that says which
    // of the two it is.
    const result = await sendSlackAlert(
      { webhookUrl: WEBHOOK, text: "something broke" },
      fakeFetch({ status: 404, body: "no_service" }),
    );

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("404");
    expect(result.detail).toContain("no_service");
  });

  it("returns rather than throws when Slack cannot be reached, and says so loudly", async () => {
    // The one failure this system cannot report through itself, so it must
    // at least reach the function logs (rule 4). It must not throw: the
    // caller has already established something is wrong and needs to
    // report the delivery outcome.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const exploding = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;

    const result = await sendSlackAlert({ webhookUrl: WEBHOOK, text: "x" }, exploding);

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("Could not reach Slack");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Could not reach Slack"));
    logged.mockRestore();
  });
});
