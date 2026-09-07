import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runIngestJob } from "@/lib/federal-register/ingest-job";
import { getServiceRoleClient } from "@/lib/supabase";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runIngestJob(getServiceRoleClient());
    return NextResponse.json(result);
  } catch (err) {
    console.error("Federal Register ingest job failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ingest job failed." },
      { status: 500 },
    );
  }
}
