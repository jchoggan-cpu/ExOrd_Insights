import { ADMINISTRATION_START_DATE } from "@/lib/federal-register/constants";
import { isPriorAdministrationHoldover } from "@/lib/federal-register/prior-administration";

// Catches a bad date even when there's no Federal Register document to
// cross-check against — the EO 14353 bug (a legacy date transposed four
// years into the future) would have been caught on day one by the first
// check alone. Flags only; never blocks a write (see CLAUDE.md — a beta
// tool with one user shouldn't risk silently dropping real data over a
// validation false positive).
export interface DateSanityCheckable {
  date_signed: string | null;
  date_published: string | null;
}

/** Returns a review_reason string if something's off, or null if the dates look sane. Checks in order, returns the first problem found. */
export function checkDateSanity(row: DateSanityCheckable, today: Date = new Date()): string | null {
  const todayIso = today.toISOString().slice(0, 10);

  if (row.date_signed && row.date_signed > todayIso) {
    return `date_signed (${row.date_signed}) is in the future.`;
  }
  if (row.date_signed && isPriorAdministrationHoldover(row.date_signed)) {
    // A pre-start date_signed isn't itself suspicious: this tracker's ingest
    // filters on date_published, not date_signed (see client.ts's
    // buildQuery), so outgoing-administration documents that happened to
    // publish late legitimately show up here — a prior-administration
    // holdover, not a data error (see prior-administration.ts). What IS
    // still suspicious is a pre-start date_signed that CAN'T be explained
    // that way: no date_published at all (never made it into the Federal
    // Register — e.g. a memorandum whose true date_signed is a month later
    // and was mistyped), or a date_published that's also pre-start.
    const explainedByHoldoverPublication =
      row.date_published !== null && row.date_published >= ADMINISTRATION_START_DATE;
    if (!explainedByHoldoverPublication) {
      const publishedDetail = row.date_published
        ? `date_published (${row.date_published}) is also before it`
        : "date_published is missing";
      return `date_signed (${row.date_signed}) is before the administration's start date (${ADMINISTRATION_START_DATE}) and ${publishedDetail} — not explained by a prior-administration holdover.`;
    }
  }
  if (row.date_signed && row.date_published && row.date_published < row.date_signed) {
    return `date_published (${row.date_published}) is before date_signed (${row.date_signed}) — Federal Register never publishes before signing.`;
  }
  return null;
}
