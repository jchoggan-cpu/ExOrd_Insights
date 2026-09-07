import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runEnrichJob } from "@/lib/federal-register/enrich-job";
import { getServiceRoleClient } from "@/lib/supabase";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runEnrichJob(getServiceRoleClient());
    return NextResponse.json(result);
  } catch (err) {
    console.error("Federal Register enrich job failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enrich job failed." },
      { status: 500 },
    );
  }
}
