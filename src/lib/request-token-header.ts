/**
 * The header name alone, in its own module so client components can import
 * it without dragging in `request-token.ts` — which uses `node:crypto` and
 * would break the browser bundle.
 *
 * A constant rather than a string literal repeated in four places (rule 5):
 * the two client components that send it and the two routes that read it
 * have to agree exactly, and a typo in one of them fails as "Unauthorized"
 * rather than as anything that points at the cause.
 */
export const REQUEST_TOKEN_HEADER = "x-eo-request-token";
