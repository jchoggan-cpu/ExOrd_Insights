import { NextResponse, type NextRequest } from "next/server";
import { SITE_AUTH_COOKIE, hashSitePassword } from "@/lib/site-auth";

/**
 * Lightweight interim access gate over the ADMIN pages only — Needs
 * Attention, Summary Prompt and API Spend — plus the endpoint that edits the
 * summarization prompt. The tracker, the order pages and the drafter stay
 * open to anyone with the link, which is the point: the tool is meant to be
 * shared, while the pages that expose flagged rows, spend and the nightly
 * prompt are not.
 *
 * A single shared password is NOT per-user access control. It keeps a demo
 * audience out of the admin pages; it does not distinguish between people.
 * Real accounts are Phase 5, and this proxy and src/app/gate/ should be
 * removed when they ship.
 *
 * Entirely inactive if SITE_PASSWORD isn't set, so local development and the
 * current deployment behave exactly as before until the variable is added.
 */
export async function proxy(request: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SITE_AUTH_COOKIE)?.value;
  const expected = await hashSitePassword(sitePassword);

  if (cookie === expected) {
    return NextResponse.next();
  }

  const gateUrl = new URL("/gate", request.url);
  gateUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(gateUrl);
}

/*
 * An explicit list rather than "everything except", which is what this used
 * to be. Listing what IS gated means a new public page is public by default;
 * the old form meant every new route was gated by accident, including
 * /api/cron/*, which must return JSON to Vercel Cron rather than a redirect
 * to an HTML page. Nothing here matches /api/cron/*, and those routes keep
 * their own CRON_SECRET check (src/lib/cron-auth.ts) regardless.
 */
export const config = {
  // Written out literally, NOT imported from src/lib/admin-routes.ts, even
  // though that is the shared list every other caller uses. Next parses this
  // at build time and rejects a computed value: "matcher needs to be a
  // static string or array of static strings". admin-routes.test.ts asserts
  // these patterns and that list stay in step, so the duplication cannot
  // drift silently.
  matcher: [
    "/needs-attention",
    "/needs-attention/:path*",
    "/prompt",
    "/prompt/:path*",
    "/usage",
    "/usage/:path*",
    "/api/summary-prompt",
    "/api/summary-prompt/:path*",
  ],
};
