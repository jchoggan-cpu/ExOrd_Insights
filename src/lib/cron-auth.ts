/**
 * Verifies a request came from Vercel Cron rather than an arbitrary caller.
 * Vercel sends the CRON_SECRET value configured for the project as a Bearer
 * token on every scheduled invocation — without this check, anyone who
 * finds a cron endpoint's URL could trigger writes or spend Anthropic
 * budget on demand. Every /api/cron/* route must call this first.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unconfigured secret must never mean "allow everyone."
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
