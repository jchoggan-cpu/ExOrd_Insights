import type { CourtListenerDocket } from "./types";

const SEARCH_URL = "https://www.courtlistener.com/api/rest/v4/search/";
const SITE_BASE_URL = "https://www.courtlistener.com";

// RECAP — the federal PACER dockets mirror. The alternative ("o", published
// opinions) only covers cases that produced a written opinion, which most
// pending challenges have not.
const RECAP_SEARCH_TYPE = "r";

// CourtListener is a free service run by a nonprofit; identifying the client
// is the courtesy their API terms ask for.
const USER_AGENT = "Sheppard EO Tracker (legal-challenge docket linking)";

// Anonymous callers are throttled hard — observed 429ing after ~25 requests
// spaced 1.2s apart. Retrying is expected operation here, not an edge case.
const MAX_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 10_000;
const THROTTLED_STATUSES = [429, 503];

/**
 * What one search saw. `truncated` matters: CourtListener pages at 20
 * results, and the gate's "no rival candidate" test is only honest if the
 * whole result set was actually examined.
 */
export interface DocketSearchResult {
  dockets: CourtListenerDocket[];
  truncated: boolean;
}

/**
 * The one call this project makes against CourtListener, expressed as a type
 * so jobs and tests can be handed a fake instead of the real thing (no test
 * in this project makes a network call).
 */
export type SearchDockets = (params: { caseName: string; courtId?: string | null }) => Promise<DocketSearchResult>;

/**
 * Single access point for the CourtListener credential (see CLAUDE.md rule
 * 6). The token is optional: the search endpoint answers anonymous requests
 * too, just with a much tighter rate limit. Set COURTLISTENER_API_TOKEN
 * (free, from courtlistener.com) to lift it.
 */
export function getCourtListenerToken(): string | null {
  return process.env.COURTLISTENER_API_TOKEN ?? null;
}

export interface DocketSearchDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  token?: string | null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildUrl(caseName: string, courtId?: string | null): string {
  const search = new URLSearchParams();
  // Scoped to the case caption, as a quoted phrase. Both halves matter: an
  // unquoted name matches any document containing those words, and an
  // unscoped phrase matches any document *mentioning* the case rather than
  // the docket actually named that. Measured on "Doe v. Noem" in D. Mass.:
  // 45 results unscoped (three pages of mostly unrelated dockets) against 2
  // scoped — the two genuine same-name cases, on a single page.
  search.set("q", `caseName:("${caseName.replace(/"/g, "")}")`);
  search.set("type", RECAP_SEARCH_TYPE);
  if (courtId) search.set("court", courtId);
  return `${SEARCH_URL}?${search.toString()}`;
}

/** Honour the server's own Retry-After when it sends one; otherwise back off exponentially. */
function backoffMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
}

/**
 * Builds a docket search. Dependencies are passed in rather than reached for
 * so the retry behaviour can be tested without a network call or a real wait.
 *
 * Narrowing the search happens here; *deciding* whether a result is the right
 * case is match-case.ts's job, deliberately kept separate from fetching.
 */
export function createDocketSearch(deps: DocketSearchDeps = {}): SearchDockets {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const token = deps.token !== undefined ? deps.token : getCourtListenerToken();

  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (token) headers.Authorization = `Token ${token}`;

  return async ({ caseName, courtId }) => {
    const url = buildUrl(caseName, courtId);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await fetchImpl(url, { headers });

      if (response.ok) {
        const body: { results?: CourtListenerDocket[]; next?: string | null } = await response.json();
        // A `next` URL means there are more matches than this page shows, so
        // the caller must not claim it has seen every rival docket.
        return { dockets: body.results ?? [], truncated: Boolean(body.next) };
      }

      if (THROTTLED_STATUSES.includes(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(response, attempt));
        continue;
      }

      // Every other failure, and a throttle that outlasted our retries,
      // stops the run. A refused request and a case that genuinely has no
      // docket mean completely different things, and quietly returning []
      // here would write "not found" into the review file for a case nobody
      // actually looked up.
      throw new Error(`CourtListener search failed (${response.status}) for "${caseName}"`);
    }

    throw new Error(`CourtListener search exhausted ${MAX_ATTEMPTS} attempts for "${caseName}"`);
  };
}

/** The real search, used by the CLI. */
export const searchDockets: SearchDockets = (params) => createDocketSearch()(params);

/** Turns CourtListener's site-relative docket path into a full URL. */
export function docketUrl(docket: CourtListenerDocket): string {
  return `${SITE_BASE_URL}${docket.docket_absolute_url}`;
}
