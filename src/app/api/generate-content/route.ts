import { NextResponse } from "next/server";
import { getExecutiveOrdersByIds } from "@/lib/data";
import { generateContent } from "@/lib/content-generation";
import { recordApiUsage } from "@/lib/usage/record";
import { checkGenerationLimit, limitMessage } from "@/lib/generation-limit";
import { rejectionMessage, verifyRequest } from "@/lib/request-token";
import { getServiceRoleClient } from "@/lib/supabase";
import { saveDraft } from "@/lib/content-drafts";
import { mintDeleteToken } from "@/lib/draft-delete-token";
import { splitTitleFromDraft } from "@/lib/content-header";
import type { ContentType } from "@/lib/types";

const VALID_CONTENT_TYPES: ContentType[] = [
  "client_alert",
  "blog_post",
  "talking_points",
  "social_post",
];

export async function POST(request: Request) {
  // Two gates, in cheapest-first order and both before any model call.
  // The token says who may call (scrapers and drive-by scripts, not people —
  // see request-token.ts); the hourly ceiling says how much calling can cost,
  // which is what actually bounds the bill if a token is extracted.
  const token = verifyRequest(request);
  if (!token.ok) {
    return NextResponse.json({ error: rejectionMessage(token.reason) }, { status: 401 });
  }

  const limit = await checkGenerationLimit(getServiceRoleClient());
  if (!limit.allowed) {
    return NextResponse.json(
      { error: limitMessage(limit) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { eoIds?: unknown; contentType?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { eoIds, contentType } = body;

  if (!Array.isArray(eoIds) || eoIds.length === 0 || !eoIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "eoIds must be a non-empty array of strings." }, { status: 400 });
  }

  if (typeof contentType !== "string" || !VALID_CONTENT_TYPES.includes(contentType as ContentType)) {
    return NextResponse.json(
      { error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  // Full-column fetch of exactly the selected orders, not the whole table:
  // generateContent needs eo.fullText (see content-generation.ts) to verify
  // quoted material against source text, so this can't use the list-shaped
  // getExecutiveOrders() the rest of the app reads from.
  // In its own try: this read throws on a failed query rather than quietly
  // returning the January snapshot, and every other failure in this handler
  // answers with structured JSON. Letting it escape would hand the browser a
  // bare 500 whose body is not JSON, and the drafter parses the body before
  // checking res.ok — so the attorney would see a JSON syntax error instead
  // of being told the database is unreachable.
  let selected;
  try {
    selected = await getExecutiveOrdersByIds(eoIds);
  } catch (err) {
    console.error("Failed to load the selected executive orders:", err);
    // Deliberately not err.message: a Postgres error can name columns and
    // policies, and this response goes to a browser.
    return NextResponse.json(
      { error: "Can't reach the database right now, so nothing was drafted. Try again shortly." },
      { status: 503 },
    );
  }

  if (selected.length === 0) {
    return NextResponse.json({ error: "No matching executive orders found." }, { status: 404 });
  }

  try {
    const result = await generateContent({ orders: selected, contentType: contentType as ContentType });

    // A stub draft makes no API call, so there is nothing to meter. Recording
    // is non-fatal inside recordApiUsage — a metering failure must not turn a
    // successful draft into an error for the user.
    if (result.usage && result.model) {
      await recordApiUsage(getServiceRoleClient(), {
        feature: "content",
        model: result.model,
        usage: result.usage,
      });
    }

    // Saved automatically, and shared with everyone, so a draft is never
    // lost with the tab that made it. Deliberately AFTER metering and in its
    // own try: a storage failure must not turn a draft the attorney is
    // looking at into an error, and the only thing lost is the sharing.
    let draftId: string | null = null;
    let deleteToken: string | null = null;
    if (!result.isStub) {
      try {
        draftId = await saveDraft(getServiceRoleClient(), {
          eoIds: eoIds as string[],
          contentType: contentType as ContentType,
          // The model's own title line, already parsed out for the header.
          title: splitTitleFromDraft(result.draftText).title ?? undefined,
          draftText: result.draftText,
        });
        deleteToken = mintDeleteToken(draftId);
      } catch (err) {
        console.error("Draft generated but not saved to the shared list:", err);
      }
    }

    return NextResponse.json({ ...result, draftId, deleteToken });
  } catch (err) {
    console.error("Content generation failed:", err);
    const message = err instanceof Error ? err.message : "Content generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
