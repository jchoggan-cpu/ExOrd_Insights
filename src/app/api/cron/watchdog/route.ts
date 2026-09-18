import { NextResponse } from "next/server";
import { getSiteUrl, getSlackWebhookUrl } from "@/lib/alerts/config";
import { runWatchdogJob } from "@/lib/alerts/watchdog-job";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { getServiceRoleClient } from "@/lib/supabase";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Resolved before any work: a missing or malformed webhook should fail
    // here, plainly, rather than at the moment there is finally something
    // to report.
    const webhookUrl = getSlackWebhookUrl();
    const result = await runWatchdogJob(getServiceRoleClient(), { webhookUrl, siteUrl: getSiteUrl() });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Watchdog job failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Watchdog job failed." },
      { status: 500 },
    );
  }
}
