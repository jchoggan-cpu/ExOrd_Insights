import { createHmac, timingSafeEqual } from "node:crypto";
import { REQUEST_TOKEN_HEADER } from "@/lib/request-token-header";

/**
 * Short-lived signed tokens for the two API routes that write or spend:
 * `/api/generate-content` (calls Claude, costs money) and
 * `/api/summary-prompt` (rewrites the instructions every future nightly
 * summary is generated from).
 *
 * **Be clear about what this is worth.** The pages that use these routes are
 * client components fetching from the browser, so the token is delivered to
 * the browser and a person who opens devtools can read it. This stops
 * scrapers, crawlers and drive-by scripts hitting the endpoints directly. It
 * does not stop a determined human, and it is not a substitute for auth —
 * `SITE_PASSWORD` (removed 2026-09-16 so the tracker could be shared freely)
 * or Phase 5 accounts are what actually close these routes.
 *
 * There is deliberately no token-refresh endpoint: anything that minted
 * tokens without authentication would let anyone mint one, which is the whole
 * mechanism defeated. An expired token means "reload the page".
 *
 * Expiry therefore buys little against a person — someone who can copy a
 * token can equally reload the page for a fresh one. Its real value is
 * putting a clock on a token that leaks into a screenshot, a log, or a
 * shared HAR file.
 */

/** Single access point for the signing secret (rule 6). */
function readSecret(): string | null {
  return process.env.REQUEST_TOKEN_SECRET || null;
}

/** True when the secret is configured — callers check before minting so a page can render a clear message instead of throwing. */
export function hasRequestTokenSecret(): boolean {
  return readSecret() !== null;
}

/** 12 hours: covers a full working day, so nobody hits a failure mid-task. See the note above on why a shorter window buys almost nothing. */
export const REQUEST_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** Re-exported so server code has a single import; defined in its own module because client components need it too. */
export { REQUEST_TOKEN_HEADER };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Mints a token valid for REQUEST_TOKEN_TTL_MS. Server-only — call it from a
 * server component and hand the result to the client component as a prop.
 *
 * Throws rather than returning a placeholder when the secret is missing: a
 * token that isn't really signed would sail through verification and leave
 * the routes open while looking protected.
 */
export function mintRequestToken(now: number = Date.now()): string {
  const secret = readSecret();
  if (!secret) {
    throw new Error(
      "REQUEST_TOKEN_SECRET is not set — /api/generate-content and /api/summary-prompt cannot be protected without it.",
    );
  }
  const expiresAt = now + REQUEST_TOKEN_TTL_MS;
  return `${expiresAt}.${sign(String(expiresAt), secret)}`;
}

export type TokenRejection = "missing" | "malformed" | "expired" | "bad-signature" | "not-configured";

export type VerifyResult = { ok: true } | { ok: false; reason: TokenRejection };

/**
 * Verifies a token from the request header.
 *
 * Fails closed in every direction, including when the secret is unset: an
 * unconfigured deployment refuses the request rather than waving it through,
 * which is the difference between "not protected yet" and "silently open".
 */
export function verifyRequestToken(token: string | null, now: number = Date.now()): VerifyResult {
  const secret = readSecret();
  if (!secret) return { ok: false, reason: "not-configured" };
  if (!token) return { ok: false, reason: "missing" };

  const separator = token.indexOf(".");
  if (separator === -1) return { ok: false, reason: "malformed" };

  const expiresAtText = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAtText === "" || providedSignature === "") {
    return { ok: false, reason: "malformed" };
  }

  // Signature is checked before expiry so a forged token can't be
  // distinguished from a merely stale one by how the endpoint responds.
  const expected = Buffer.from(sign(expiresAtText, secret), "utf8");
  const provided = Buffer.from(providedSignature, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "bad-signature" };
  }

  if (now >= expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Reads the token off a request and verifies it — the one call a route handler needs. */
export function verifyRequest(request: Request, now: number = Date.now()): VerifyResult {
  return verifyRequestToken(request.headers.get(REQUEST_TOKEN_HEADER), now);
}

/** What to tell the caller. Only "expired" gets a recovery instruction, because only it has one. */
export function rejectionMessage(reason: TokenRejection): string {
  if (reason === "expired") return "This page's session has expired — reload the page and try again.";
  if (reason === "not-configured") {
    return "This deployment is missing REQUEST_TOKEN_SECRET, so this endpoint is disabled.";
  }
  return "Unauthorized.";
}
