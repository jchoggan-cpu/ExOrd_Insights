import { NextResponse, type NextRequest } from "next/server";
import { SITE_AUTH_COOKIE, hashSitePassword } from "@/lib/site-auth";

/**
 * Lightweight interim access gate — a single shared password protects the
 * whole app before Supabase Auth (Phase 5) exists. Entirely inactive if
 * SITE_PASSWORD isn't set (e.g. local development). See mitigation #3 in the
 * project plan; this proxy and src/app/gate/ should be removed once real
 * auth ships.
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

export const config = {
  matcher: [
    /*
     * Match everything except:
     * - the gate page and its API route (or we'd redirect-loop)
     * - /api/cron/* — Vercel Cron sends a plain GET expecting JSON, not a
     *   redirect to an HTML gate page; those routes have their own
     *   CRON_SECRET check (see src/lib/cron-auth.ts) instead
     * - Next.js internals and static assets
     */
    "/((?!gate|api/gate|api/cron|_next/static|_next/image|favicon.ico).*)",
  ],
};
