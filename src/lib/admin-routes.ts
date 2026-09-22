/**
 * Which pages are for whoever runs this tracker rather than for the
 * attorneys reading it.
 *
 * One list, used in three places that would otherwise drift: the proxy that
 * gates them, the header that hides their links, and the tests. A page added
 * to the nav but not to this list is a page that looks restricted and is not.
 */
export const ADMIN_ROUTES = ["/needs-attention", "/prompt", "/usage"] as const;

/**
 * API routes that must be gated with them. /prompt edits the prompt the
 * nightly summarization job uses, so protecting the page while leaving the
 * endpoint open would protect nothing -- the endpoint is where the writing
 * actually happens.
 */
export const ADMIN_API_ROUTES = ["/api/summary-prompt"] as const;

/** Matcher patterns for the proxy, covering each route and anything beneath it. */
export const ADMIN_MATCHER = [...ADMIN_ROUTES, ...ADMIN_API_ROUTES].flatMap((route) => [
  route,
  `${route}/:path*`,
]);

export function isAdminRoute(pathname: string): boolean {
  return [...ADMIN_ROUTES, ...ADMIN_API_ROUTES].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
