import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase";
import { saveSummaryPrompt } from "@/lib/summary-prompt/store";
import { validateSummaryPrompt } from "@/lib/summary-prompt/render";

/**
 * Saves a new version of the summarization prompt.
 *
 * Uses the service-role client because `summary_prompts` write policies are
 * is_admin()-gated (migration 0005) and Supabase Auth doesn't exist yet —
 * the access boundary today is SITE_PASSWORD, same as the rest of the app.
 * Revisit at Phase 5 alongside the policies themselves.
 */
export async function POST(request: Request) {
  let body: { body?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body.body !== "string") {
    return NextResponse.json({ error: "body must be a string." }, { status: 400 });
  }

  if (body.note !== undefined && typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be a string when provided." }, { status: 400 });
  }

  // Validated here as well as inside saveSummaryPrompt so the UI gets the
  // itemized list back to display, rather than one flattened message.
  const { errors, warnings } = validateSummaryPrompt(body.body);
  if (errors.length > 0) {
    return NextResponse.json({ errors, warnings }, { status: 400 });
  }

  try {
    const { id } = await saveSummaryPrompt(getServiceRoleClient(), {
      body: body.body,
      note: body.note,
    });
    return NextResponse.json({ id, warnings });
  } catch (err) {
    console.error("Saving the summarization prompt failed:", err);
    const message = err instanceof Error ? err.message : "Saving the prompt failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
