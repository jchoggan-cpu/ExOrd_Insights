/**
 * The tracker's search/filter/sort/page state, as carried in the URL.
 *
 * Pure parsing and serializing, no database access — the page reads these
 * off searchParams on the server, the controls write them back on the
 * client, and both must agree exactly or the UI and the results drift apart.
 * Keeping it here means there is one definition of "page 2" rather than two
 * that can diverge.
 *
 * Everything is validated rather than trusted: these values arrive from a
 * URL a person can type or edit by hand.
 */

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number] | "all";
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export type SortMode = "relevance" | "date";
export const DEFAULT_SORT: SortMode = "date";

export const STATUSES = ["active", "amended", "revoked"] as const;

export interface TrackerQuery {
  search: string;
  /**
   * Selected practice areas. Several may be chosen at once and they widen
   * the result set rather than narrowing it (OR), which is how a reader
   * expects checkboxes to behave. A selected parent also matches its
   * subgroups — see migration 0008.
   */
  practiceAreas: string[];
  /** Selected industries, OR'd with each other, AND'd against practiceAreas. */
  industries: string[];
  status: string;
  /** Inclusive bounds on date_signed, as ISO dates. Empty means unbounded. */
  dateFrom: string;
  dateTo: string;
  sort: SortMode;
  /** 1-based, as shown to the reader. */
  page: number;
  pageSize: PageSize;
}

/** Raw `searchParams` as Next hands them over: a value may be absent, single, or repeated. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

/**
 * Every value for a repeated parameter ("?practice=Tax&practice=Litigation"),
 * de-duplicated and with blanks dropped. Next hands a repeated parameter over
 * as an array and a single one as a string, so both shapes arrive here.
 */
function allValues(raw: string | string[] | undefined): string[] {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return [...new Set(values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
}

// A hand-edited "?from=last-tuesday" must not reach SQL as a date.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(raw: string): string {
  if (!ISO_DATE.test(raw)) return "";
  return Number.isNaN(Date.parse(raw)) ? "" : raw;
}

function parsePageSize(raw: string): PageSize {
  if (raw === "all") return "all";
  const parsed = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(parsed) ? (parsed as PageSize) : DEFAULT_PAGE_SIZE;
}

function parsePage(raw: string): number {
  const parsed = Number(raw);
  // A hand-edited "?page=0" or "?page=-3" must not produce a negative offset.
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function parseTrackerQuery(params: RawSearchParams): TrackerQuery {
  const sort = firstValue(params.sort);
  const status = firstValue(params.status);

  return {
    search: firstValue(params.q).trim(),
    practiceAreas: allValues(params.practice),
    industries: allValues(params.industry),
    dateFrom: parseIsoDate(firstValue(params.from)),
    dateTo: parseIsoDate(firstValue(params.to)),
    // An unrecognized status would silently match nothing; drop it instead.
    status: (STATUSES as readonly string[]).includes(status) ? status : "",
    sort: sort === "relevance" ? "relevance" : DEFAULT_SORT,
    page: parsePage(firstValue(params.page)),
    pageSize: parsePageSize(firstValue(params.size)),
  };
}

/**
 * Serializes back to a query string, omitting anything at its default so the
 * common case is a clean URL rather than one carrying six redundant
 * parameters.
 */
export function buildTrackerQueryString(query: Partial<TrackerQuery>): string {
  const params = new URLSearchParams();

  if (query.search) params.set("q", query.search);
  for (const area of query.practiceAreas ?? []) params.append("practice", area);
  for (const industry of query.industries ?? []) params.append("industry", industry);
  if (query.status) params.set("status", query.status);
  if (query.dateFrom) params.set("from", query.dateFrom);
  if (query.dateTo) params.set("to", query.dateTo);
  if (query.sort && query.sort !== DEFAULT_SORT) params.set("sort", query.sort);
  if (query.pageSize && query.pageSize !== DEFAULT_PAGE_SIZE) params.set("size", String(query.pageSize));
  if (query.page && query.page > 1) params.set("page", String(query.page));

  return params.toString();
}

/**
 * Applies a change and returns the new query. Any change to what is being
 * searched or filtered resets to page 1 — otherwise narrowing a 20-page
 * result while on page 12 lands the reader on an empty page, which reads as
 * "no results" rather than "you moved".
 */
export function withTrackerChange(
  current: TrackerQuery,
  change: Partial<TrackerQuery>,
): TrackerQuery {
  const next = { ...current, ...change };
  const changesResultSet =
    change.search !== undefined ||
    change.practiceAreas !== undefined ||
    change.industries !== undefined ||
    change.status !== undefined ||
    change.dateFrom !== undefined ||
    change.dateTo !== undefined ||
    change.pageSize !== undefined ||
    change.sort !== undefined;

  if (changesResultSet && change.page === undefined) next.page = 1;
  return next;
}

/** Rows to skip for this page. "all" has no offset — there is only one page. */
export function offsetFor(query: TrackerQuery): number {
  if (query.pageSize === "all") return 0;
  return (query.page - 1) * query.pageSize;
}

export function totalPagesFor(total: number, pageSize: PageSize): number {
  if (pageSize === "all") return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
