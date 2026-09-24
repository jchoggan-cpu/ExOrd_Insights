import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proof that this browser is the one that generated a given draft.
 *
 * Drafts are saved automatically and shared anonymously, so there is no
 * account to own one and no `created_by` to check against. Without something
 * like this, "delete this draft" would mean "anyone who knows the id may
 * delete it" -- and the shared list publishes every id, so that is everyone.
 *
 * The token is an HMAC of the draft's id, handed back once to the browser
 * that created it and never included in any listing. Deriving it rather than
 * storing a column keeps this off the schema entirely: the server can
 * recompute and compare, so there is nothing to migrate and nothing extra to
 * leak.
 *
 * It is a capability, not an identity. Whoever holds the token can delete
 * that draft; the server cannot tell whether they are the person who made
 * it. That is the accepted cost of the anonymous interim -- see the README's
 * Next steps -- and it is why the admin pages get their own delete as well.
 */

/** Shares REQUEST_TOKEN_SECRET rather than adding a second secret to configure and forget. */
function readSecret(): string | null {
  return process.env.REQUEST_TOKEN_SECRET || null;
}

function sign(draftId: string, secret: string): string {
  return createHmac("sha256", secret).update(`draft:${draftId}`).digest("hex");
}

/**
 * Returns null when no secret is configured, rather than an unsigned
 * placeholder. A fake token would verify as "wrong" rather than "absent",
 * which would leave the delete button on screen doing nothing.
 */
export function mintDeleteToken(draftId: string): string | null {
  const secret = readSecret();
  if (!secret) return null;
  return sign(draftId, secret);
}

export function verifyDeleteToken(draftId: string, provided: string | null): boolean {
  const secret = readSecret();
  // Fails closed: an unconfigured deployment refuses deletes rather than
  // allowing every one of them.
  if (!secret || !provided) return false;

  const expected = Buffer.from(sign(draftId, secret), "utf8");
  const candidate = Buffer.from(provided, "utf8");
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}
