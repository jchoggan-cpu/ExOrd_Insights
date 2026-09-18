/**
 * The single place alerting configuration is read from (rule 6). Nothing
 * else in src/lib/alerts touches process.env.
 *
 * Both accessors throw rather than returning a default, and the watchdog
 * route calls them before doing any work — so a missing webhook fails
 * loudly and immediately instead of at the moment there is finally
 * something to report, which is the worst possible time to discover it.
 * That is not a hypothetical preference here: an ANTHROPIC_API_KEY that was
 * registered but empty took eight nights to notice precisely because
 * nothing checked it up front.
 */
export function getSlackWebhookUrl(): string {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    throw new Error(
      "No alert channel configured — set SLACK_ALERT_WEBHOOK_URL to a Slack incoming webhook URL. " +
        "Note that a Vercel environment variable can exist and still be empty; this error means the stored value is blank.",
    );
  }
  if (!url.startsWith("https://hooks.slack.com/")) {
    throw new Error(
      `SLACK_ALERT_WEBHOOK_URL is set but does not look like a Slack incoming webhook (expected https://hooks.slack.com/..., got ${url.length} characters starting "${url.slice(0, 8)}").`,
    );
  }
  return url;
}

/**
 * The deployed site's own base URL, used only to build the /needs-attention
 * link in an alert. Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every
 * deployment; the fallback keeps local runs readable rather than failing a
 * real alert over a cosmetic link.
 */
export function getSiteUrl(): string {
  const configured = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return configured ? `https://${configured}` : "http://localhost:3000";
}
