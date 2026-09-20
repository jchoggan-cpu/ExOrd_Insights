/**
 * One job: GET a federalregister.gov URL, riding out a throttle or a
 * transient server error instead of letting the first one end the run.
 *
 * Why this exists: on 2026-09-19 the nightly ingest run died in 0.42
 * seconds because every one of its 47 raw-text requests came back 429.
 * A bare fetch has no retry, no backoff and no timeout of its own, so a
 * momentary refusal looked identical to a permanent failure.
 */

// Identifying the client is what federalregister.gov's fair-use terms ask
// for, and an unnamed caller is the first thing a WAF throttles. The
// CourtListener client sends one for the same reason; this one never did.
const USER_AGENT = "Sheppard EO Tracker (https://ex-ord-insights.vercel.app)";

/**
 * Deliberately far less patient than the CourtListener client's 5 attempts
 * from a 10-second base. That one runs in a local CLI with no deadline;
 * these three run as Vercel cron functions with a hard execution cap, and
 * ingest is idempotent and runs again tomorrow. So a throttle we cannot
 * shake in a few seconds is better reported (the watchdog posts it to
 * Slack) than waited out until the platform kills the invocation mid-run.
 */
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 2_000;

/**
 * The longest we will ever sleep between attempts — including when the
 * server names its own figure. A Retry-After of an hour is a perfectly
 * legal answer to a 429, and honouring one inside a cron function would
 * hang the run until the platform killed it.
 */
const MAX_BACKOFF_MS = 10_000;

/** Statuses worth trying again: a throttle, and the transient 5xx family. A 404 or a 400 is an answer, not a hiccup. */
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

/**
 * How long to wait for one request before abandoning it and retrying.
 * `fetch` has no timeout of its own, so without this a stalled connection
 * sits there until the whole function is killed — which is exactly how a
 * CourtListener --apply pass once idled for eleven minutes.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** A GET that has already done its own retrying. The response may still be non-ok; what that *means* is the caller's to decide. */
export type RetryingFetch = (url: string) => Promise<Response>;

export interface RetryingFetchDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait before the next attempt, or null to stop retrying now.
 *
 * The server's own Retry-After wins when it sends a usable one — it knows
 * when its bucket refills and we do not. But a figure past MAX_BACKOFF_MS
 * ends the attempts rather than being clamped down to the cap: sleeping
 * ten seconds when we have been told to wait an hour just spends the
 * run's remaining budget on a request certain to be refused again.
 */
export function backoffMs(response: Response | null, attempt: number): number | null {
  const retryAfterSeconds = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    const requestedMs = retryAfterSeconds * 1000;
    return requestedMs > MAX_BACKOFF_MS ? null : requestedMs;
  }
  return Math.min(INITIAL_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/** Releases a response we are about to throw away. Failing to drain it is not worth failing the request over. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Safe to swallow (rule 4): this is cleanup of a response whose content
    // we have already decided to discard. The retry below is what matters,
    // and a stream that cannot be cancelled is already finished with.
  }
}

/**
 * Builds the retrying GET. Dependencies are passed in rather than reached
 * for (rule 3) so the backoff can be tested without a network call or a
 * real wait — no test in this project sleeps or touches the network.
 */
export function createRetryingFetch(deps: RetryingFetchDeps = {}): RetryingFetch {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  return async (url) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        // A timeout or a dropped connection, not an answer from the
        // server. Worth another try for the same reason a 429 is. The
        // last attempt rethrows: a request that never completed must
        // never be mistaken for a document that does not exist.
        const wait = attempt < MAX_ATTEMPTS ? backoffMs(null, attempt) : null;
        if (wait === null) {
          throw new Error(
            `Federal Register request failed after ${attempt} attempt(s): ${url} — ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          );
        }
        // Not swallowed silently (rule 4): a retry that then succeeds
        // leaves no other trace anywhere — not in ingestion_runs, not in
        // the watchdog's view — so absorbing a throttle quietly is how a
        // tightening rate limit would stay invisible until it finally
        // broke a run outright. This line is the early warning.
        console.warn(
          `Federal Register request attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying in ${wait}ms: ${url} — ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
        await sleep(wait);
        continue;
      }

      if (response.ok) return response;

      const wait = RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_ATTEMPTS
        ? backoffMs(response, attempt)
        : null;
      if (wait === null) return response;
      console.warn(
        `Federal Register answered ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${wait}ms: ${url}`,
      );
      // Nothing will read this body, and an unread one keeps its
      // connection checked out until the runtime gets around to dumping it.
      await discardBody(response);
      await sleep(wait);
    }

    // Unreachable: the loop's last iteration either returns or throws.
    throw new Error(`Federal Register request exhausted ${MAX_ATTEMPTS} attempts: ${url}`);
  };
}

/** The real GET, used by client.ts. */
export const retryingFetch: RetryingFetch = (url) => createRetryingFetch()(url);
