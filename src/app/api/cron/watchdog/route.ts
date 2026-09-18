import { NextResponse } from "next/server";
import { getSiteUrl, getSlackWebhookUrl } from "@/lib/alerts/config";
import { runWatchdogJob } from "@/lib/alerts/watchdog-job";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { getServiceRoleClient } from "@/lib/supabase";

/**
 * Forces a message even when nothing is wrong, so the channel can be proven
 * on demand instead of waiting for the next weekly all-clear.
 *
 * This exists because of what the ordinary healthy path cannot tell you. A
 * quiet watchdog is indistinguishable from a broken one, and the production
 * webhook is a Vercel Secret whose value cannot be read back — so "the
 * variable is listed" is not evidence it holds a working URL, and a URL
 * truncated on paste would only reveal itself as a Monday note that never
 * arrived. Reachable only with CRON_SECRET, which is Vercel's and yours.
 */
const VERIFY_PARAM = "verify";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const verifyOnly = new URL(request.url).searchParams.get(VERIFY_PARAM) === "1";

  try {
    // Resolved before any work: a missing or malformed webhook should fail
    // here, plainly, rather than at the moment there is finally something
    // to report.
    const webhookUrl = getSlackWebhookUrl();
    const result = await runWatchdogJob(
      getServiceRoleClient(),
      { webhookUrl, siteUrl: getSiteUrl() },
      { forceSend: verifyOnly },
    );
    return NextResponse.json({ ...result, verify: verifyOnly });
  } catch (err) {
    console.error("Watchdog job failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Watchdog job failed." },
      { status: 500 },
    );
  }
}
