import { cookies } from "next/headers";
import { SITE_AUTH_COOKIE, hashSitePassword } from "@/lib/site-auth";

/**
 * Whether this request may see the admin pages.
 *
 * Mirrors the check in src/proxy.ts rather than replacing it. The proxy is
 * what actually protects the routes; this is only so the header does not
 * advertise links that would bounce the reader to a password prompt. If the
 * two ever disagree the proxy wins, which is the safe direction: a hidden
 * link to a page you can open is a cosmetic bug, a shown link to one you
 * cannot is merely annoying, and neither grants access.
 */
export async function hasAdminAccess(): Promise<boolean> {
  const sitePassword = process.env.SITE_PASSWORD;
  // No password configured means the gate is off entirely -- local
  // development, and production until the variable is set.
  if (!sitePassword) return true;

  const cookieStore = await cookies();
  const cookie = cookieStore.get(SITE_AUTH_COOKIE)?.value;
  if (!cookie) return false;

  return cookie === (await hashSitePassword(sitePassword));
}
