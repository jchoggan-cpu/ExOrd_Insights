import { NextResponse } from "next/server";
import { SITE_AUTH_COOKIE, hashSitePassword } from "@/lib/site-auth";

export async function POST(request: Request) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    // Gate isn't configured — nothing to check against.
    return NextResponse.json({ error: "Access gate is not configured." }, { status: 500 });
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body.password !== "string" || body.password !== sitePassword) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SITE_AUTH_COOKIE, await hashSitePassword(sitePassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}
