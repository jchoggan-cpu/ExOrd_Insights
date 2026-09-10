import { categorizeReviewReason, type ReviewReasonCategory } from "@/lib/diagnostics/categorize-review-reason";
import { checkDateSanity } from "@/lib/federal-register/date-sanity";
import { isPriorAdministrationHoldover } from "@/lib/federal-register/prior-administration";
import { findDuplicateEoNumbers } from "@/lib/federal-register/reconcile-legacy";

export interface DiagnosticsRow {
  id: string;
  eo_number: string | null;
  title: string;
  date_signed: string | null;
  date_published: string | null;
  needs_review: boolean;
  review_reason: string | null;
}

export interface DateSanityFailure {
  id: string;
  eoNumber: string | null;
  reason: string;
}

/**
 * Every row whose date_signed predates the administration (see
 * prior-administration.ts) — purely a date fact, reported informationally
 * so a reader knows these rows exist. Most won't also appear in
 * dateSanityFailures (a holdover explained by its date_published is no
 * longer flagged there — see date-sanity.ts). A row CAN appear in both
 * lists: that means its date_signed predates the administration AND isn't
 * explained by its date_published, i.e. it's still a suspected data error,
 * not a confirmed holdover.
 */
export interface PriorAdministrationHoldover {
  id: string;
  eoNumber: string | null;
}

export interface DiagnosticsReport {
  totalRows: number;
  dateSanityFailures: DateSanityFailure[];
  priorAdministrationHoldovers: PriorAdministrationHoldover[];
  duplicateEoNumbers: string[];
  needsReviewTotal: number;
  needsReviewByCategory: Partial<Record<ReviewReasonCategory, number>>;
}

/** Pure: takes an already-fetched snapshot of executive_orders and reports on it. No I/O, so it's fully unit-testable and reusable from both the CLI script and (later) a /needs-attention summary. */
export function buildDiagnosticsReport(rows: DiagnosticsRow[], today: Date = new Date()): DiagnosticsReport {
  const dateSanityFailures: DateSanityFailure[] = [];
  for (const row of rows) {
    const reason = checkDateSanity(row, today);
    if (reason) dateSanityFailures.push({ id: row.id, eoNumber: row.eo_number, reason });
  }

  const priorAdministrationHoldovers: PriorAdministrationHoldover[] = rows
    .filter((row) => isPriorAdministrationHoldover(row.date_signed))
    .map((row) => ({ id: row.id, eoNumber: row.eo_number }));

  const eoRows = rows
    .filter((row): row is DiagnosticsRow & { eo_number: string } => row.eo_number !== null)
    .map((row) => ({ id: row.id, eo_number: row.eo_number, title: row.title, date_signed: row.date_signed }));
  const duplicateEoNumbers = [...findDuplicateEoNumbers(eoRows)].sort();

  const needsReviewByCategory: Partial<Record<ReviewReasonCategory, number>> = {};
  let needsReviewTotal = 0;
  for (const row of rows) {
    if (!row.needs_review) continue;
    needsReviewTotal++;
    const category = categorizeReviewReason(row.review_reason) ?? "other";
    needsReviewByCategory[category] = (needsReviewByCategory[category] ?? 0) + 1;
  }

  return {
    totalRows: rows.length,
    dateSanityFailures,
    priorAdministrationHoldovers,
    duplicateEoNumbers,
    needsReviewTotal,
    needsReviewByCategory,
  };
}
