import { NextResponse } from "next/server";
import { getExecutiveOrders } from "@/lib/data";
import { generateContent } from "@/lib/content-generation";
import type { ContentType } from "@/lib/types";

const VALID_CONTENT_TYPES: ContentType[] = [
  "client_alert",
  "blog_post",
  "talking_points",
  "social_post",
];

export async function POST(request: Request) {
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

  const allOrders = await getExecutiveOrders();
  const selected = allOrders.filter((eo) => eoIds.includes(eo.id));

  if (selected.length === 0) {
    return NextResponse.json({ error: "No matching executive orders found." }, { status: 404 });
  }

  try {
    const result = await generateContent({ orders: selected, contentType: contentType as ContentType });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Content generation failed:", err);
    const message = err instanceof Error ? err.message : "Content generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
