import { NextResponse } from "next/server";
import { deleteDraft } from "@/lib/content-drafts";
import { verifyDeleteToken } from "@/lib/draft-delete-token";
import { hasActiveAdminSession } from "@/lib/site-access";
import { getServiceRoleClient } from "@/lib/supabase";

/**
 * Deleting a shared draft.
 *
 * Two ways in, because drafts are anonymous and neither alone is enough:
 *
 * - The browser that created it presents the delete token it was handed on
 *   generation. That covers "I just made this and it is wrong", which is the
 *   common case and the one the feature was asked for.
 * - An active admin session may delete any draft. That covers everything
 *   else, because once the creating tab is gone nobody holds the token and
 *   an anonymous draft would otherwise be permanent.
 *
 * Admin here means the shared-password gate is BOTH configured and
 * satisfied. hasAdminAccess() deliberately returns true when SITE_PASSWORD
 * is unset so local development works, and that must not become "anyone may
 * delete anything" on a deployment with the gate switched off.
 */
export async function DELETE(request: Request) {
  let body: { id?: unknown; deleteToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { id, deleteToken } = body;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "A draft id is required." }, { status: 400 });
  }

  const holdsToken = typeof deleteToken === "string" && verifyDeleteToken(id, deleteToken);
  if (!holdsToken && !(await hasActiveAdminSession())) {
    // Same answer either way: a caller learns nothing about whether the
    // draft exists, only that they may not remove it.
    return NextResponse.json({ error: "Not allowed to delete this draft." }, { status: 403 });
  }

  try {
    await deleteDraft(getServiceRoleClient(), id);
  } catch (err) {
    console.error("Failed to delete draft:", err);
    return NextResponse.json({ error: "Could not delete that draft. Try again shortly." }, { status: 503 });
  }

  return NextResponse.json({ deleted: true });
}
