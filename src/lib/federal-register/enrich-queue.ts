// The minimum a query builder must support to be filtered by the predicate
// below. Structural, so both the real supabase-js builder and the test fake
// satisfy it without either knowing about this file.
interface QueueFilterable {
  is(column: string, value: null): QueueFilterable;
  not(column: string, operator: "is", value: null): QueueFilterable;
}

/**
 * The one definition of "waiting to be summarized", used by the enrichment
 * job that works the queue, the watchdog that reports on its depth, and
 * `npm run enrich:all`, which prices it.
 *
 * It lives in one place because those three must agree exactly. If the
 * watchdog counted rows the job would not select, it would report work
 * permanently waiting that nothing was ever going to pick up — every night,
 * forever, which is precisely how an alert becomes something you learn to
 * ignore. `enrich:all` counting differently would misprice a run.
 *
 * KNOWN ISSUE, deliberately not fixed here: a row flagged for an
 * unverifiable quote keeps ai_summary NULL, so it stays in this queue and
 * is re-summarized on every nightly run, indefinitely, billing a model call
 * each time (~$0.08 a row a night). Adding `needs_review = false` here is
 * the obvious fix and is WRONG on its own: nothing in this app can clear a
 * review flag. `needs_review` is not in CORRECTABLE_FIELDS
 * (src/lib/corrections/correction-record.ts), /needs-attention is a
 * read-only list, and the only code that ever writes `false` is
 * reconcile-legacy.ts for rows it matched to the spreadsheet. So excluding
 * flagged rows would trade a bounded, visible cost leak for unbounded
 * silent starvation — a row flagged by sync.ts's date-sanity check would
 * never be summarized again, and `npm run correct`'s promise that clearing
 * a field lets "the pipeline regenerate it" would become false. Excluding
 * them needs a way to un-flag a row first. Until then the watchdog's
 * enrichment-stalled check is what surfaces a stuck row, within two nights.
 */
export function applyEnrichQueueFilter<T>(query: T): T {
  // The two casts are deliberate and contained. Expressing this as
  // `<T extends QueueFilterable<T>>` is the natural signature, but
  // supabase-js's builder types are generic enough that the self-reference
  // makes the compiler give up ("type instantiation is excessively deep").
  // Narrowing to the two methods actually called, then handing the caller's
  // own type back, keeps every call site fully typed — including the
  // .limit() and await that follow — while this file stays the single
  // definition of the predicate.
  const filterable = query as unknown as QueueFilterable;
  return filterable.is("ai_summary", null).not("full_text", "is", null) as unknown as T;
}
