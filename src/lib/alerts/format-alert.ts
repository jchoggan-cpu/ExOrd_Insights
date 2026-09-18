import type { HealthReport } from "@/lib/alerts/check-health";

const TRACKER_ATTENTION_PATH = "/needs-attention";

/**
 * Turns a health report into the Slack message text. Pure, and separate
 * from both the checking and the sending, so the wording can be tested
 * without a webhook and changed without touching either.
 *
 * Every message ends with a link to /needs-attention rather than trying to
 * carry the full picture itself: the alert's job is to get someone to look,
 * not to replace looking.
 *
 * `forced` distinguishes an on-demand channel test from the real weekly
 * all-clear. They must not look alike: a test fired on a Thursday that read
 * as the Monday note would be worse than sending nothing, because the whole
 * value of the Monday note is that its absence means something.
 */
export function formatAlert(
  report: HealthReport,
  siteUrl: string,
  { forced = false }: { forced?: boolean } = {},
): string {
  const attentionLink = `${siteUrl.replace(/\/$/, "")}${TRACKER_ATTENTION_PATH}`;

  if (report.problems.length === 0) {
    if (forced) {
      return [
        ":satellite_antenna: *EO Tracker — channel test*",
        "Someone asked for this one deliberately; it is not the weekly all-clear and not a scheduled report.",
        "If you are reading it, the webhook stored in production works — which is the one thing a quiet watchdog can never tell you.",
        "",
        "Ingestion, enrichment and reconciliation are all healthy as of right now.",
        `<${attentionLink}|Needs Attention>`,
      ].join("\n");
    }
    return [
      ":white_check_mark: *EO Tracker — weekly all-clear*",
      "Ingestion, enrichment and reconciliation all ran on schedule, with nothing failed and nothing stalled.",
      "",
      "This note arrives once a week whether or not anything is wrong. _If a Monday goes by without it, that itself is the alarm_ — it means the watchdog stopped running and its silence can no longer be trusted.",
      `<${attentionLink}|Needs Attention>`,
    ].join("\n");
  }

  const plural = report.problems.length === 1 ? "problem" : "problems";
  const lines = [`:rotating_light: *EO Tracker — ${report.problems.length} ${plural}*`, ""];

  for (const problem of report.problems) {
    lines.push(`*${problem.headline}*`);
    lines.push(problem.detail);
    lines.push("");
  }

  lines.push(`<${attentionLink}|Needs Attention>`);
  return lines.join("\n");
}
