import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runReconcileJob } from "@/lib/federal-register/reconcile-job";
import { getServiceRoleClient } from "@/lib/supabase";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReconcileJob(getServiceRoleClient());
    return NextResponse.json(result);
  } catch (err) {
    console.error("Federal Register reconciliation job failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reconciliation job failed." },
      { status: 500 },
    );
  }
}
