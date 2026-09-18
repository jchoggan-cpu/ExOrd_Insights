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
 */
export function formatAlert(report: HealthReport, siteUrl: string): string {
  const attentionLink = `${siteUrl.replace(/\/$/, "")}${TRACKER_ATTENTION_PATH}`;

  if (report.problems.length === 0) {
    return [
      ":white_check_mark: *EO Tracker — weekly all-clear*",
      "Ingestion, enrichment and reconciliation all ran on schedule, with nothing failed and nothing stalled.",
      "",
      `This note arrives once a week whether or not anything is wrong. _If a Monday goes by without it, that itself is the alarm_ — it means the watchdog stopped running and its silence can no longer be trusted.`,
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
