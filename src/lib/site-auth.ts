export const SITE_AUTH_COOKIE = "site_auth";

/**
 * Hashes the site password so the cookie never carries the plaintext value.
 * This is a lightweight interim gate (see mitigation #3 in the project plan)
 * — not a real accounts system. It goes away once Supabase Auth (Phase 5)
 * ships.
 */
export async function hashSitePassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
