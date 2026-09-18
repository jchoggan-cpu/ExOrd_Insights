import { formatError } from "@/lib/format-error";

// Injectable so tests never make a real network call and never need a real
// webhook URL (rule 3). Defaults to the platform fetch.
export type FetchLike = typeof fetch;

export interface SendResult {
  delivered: boolean;
  detail: string;
}

/**
 * Posts one message to a Slack incoming webhook.
 *
 * Returns a result rather than throwing, because the caller (the watchdog)
 * has already established that something is wrong and needs to report the
 * delivery outcome in its own HTTP response and logs — a throw here would
 * discard that. Slack answers a good post with 200 and the body "ok"; it
 * answers a revoked or mistyped webhook with 404 "no_service", which is
 * worth surfacing verbatim rather than flattening to "failed".
 */
export async function sendSlackAlert(
  { webhookUrl, text }: { webhookUrl: string; text: string },
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = (await response.text()).slice(0, 200);
    if (!response.ok) {
      return { delivered: false, detail: `Slack returned ${response.status}: ${body}` };
    }
    return { delivered: true, detail: `Slack returned ${response.status}: ${body}` };
  } catch (err) {
    // A network failure reaching Slack is the one failure this system
    // cannot report through itself. Log it so it is at least in the
    // function's Vercel logs (rule 4) and tell the caller.
    const detail = `Could not reach Slack: ${formatError(err)}`;
    console.error(detail);
    return { delivered: false, detail };
  }
}
