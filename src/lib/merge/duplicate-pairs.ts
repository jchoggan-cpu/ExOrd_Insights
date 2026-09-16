/**
 * Finding orders that were recorded twice — once from the firm's
 * spreadsheet, once from the Federal Register.
 *
 * The historical backfill reconciled legacy rows to Federal Register
 * documents by matching `eo_number`. Proclamations and memoranda have no EO
 * number, so 62 of them were never matched and were inserted a second time
 * alongside the originals. `duplicate-eo-numbers.ts` cannot see any of them,
 * because it only compares EO numbers.
 *
 * Matching is on normalized title AND signing date, never title alone.
 * "Further Extending the TikTok Enforcement Delay" is the title of two
 * genuinely different orders (EO 14310, signed 2025-06-19, and EO 14350,
 * signed 2025-09-16); a title-only rule would merge them into one and lose a
 * real order.
 */

/** Only the columns pairing needs. The merge itself reads every column, hence the open index signature. */
export type OrderRow = Record<string, unknown> & {
  id: string;
  title: string;
  date_signed: string | null;
  document_number: string | null;
};

export interface DuplicatePair {
  /** The firm's row: carries the hand-written analysis, and the id other records already reference. */
  legacy: OrderRow;
  /** The ingested row: carries document_number, citation, full_text and the official URL. */
  federalRegister: OrderRow;
}

/** A group that matched but isn't the expected one-legacy-plus-one-Federal-Register shape. Reported, never silently dropped. */
export interface IrregularGroup {
  key: string;
  rows: OrderRow[];
  reason: string;
}

export interface DuplicateScan {
  pairs: DuplicatePair[];
  irregular: IrregularGroup[];
  /** Rows excluded from matching because they have no signing date to match on. */
  undatedCount: number;
}

/**
 * Case, punctuation and whitespace differences only. Deliberately not
 * fuzzy: two titles that differ by an actual word are two different
 * documents as far as this is concerned, and a human should look at them.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function pairKey(title: string, dateSigned: string): string {
  return `${normalizeTitle(title)}|${dateSigned}`;
}

/** A row is the Federal Register side exactly when ingestion has given it a document_number. */
function isFederalRegisterSide(row: OrderRow): boolean {
  return row.document_number !== null && row.document_number !== undefined;
}

/**
 * Groups rows by title+date and splits each group into a legacy row and a
 * Federal Register row.
 *
 * Anything that doesn't come out as exactly one of each is returned as
 * `irregular` rather than merged on a guess — three rows sharing a title, or
 * two legacy rows with no ingested counterpart, mean something this function
 * didn't anticipate, and merging them automatically could destroy a record.
 */
export function findDuplicatePairs(rows: OrderRow[]): DuplicateScan {
  const groups = new Map<string, OrderRow[]>();
  let undatedCount = 0;

  for (const row of rows) {
    if (!row.date_signed) {
      undatedCount++;
      continue;
    }
    const key = pairKey(row.title, row.date_signed);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const pairs: DuplicatePair[] = [];
  const irregular: IrregularGroup[] = [];

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const federalRegister = group.filter(isFederalRegisterSide);
    const legacy = group.filter((row) => !isFederalRegisterSide(row));

    if (group.length === 2 && legacy.length === 1 && federalRegister.length === 1) {
      pairs.push({ legacy: legacy[0], federalRegister: federalRegister[0] });
      continue;
    }

    irregular.push({
      key,
      rows: group,
      reason:
        `${group.length} rows share this title and signing date ` +
        `(${legacy.length} without a document_number, ${federalRegister.length} with one) — ` +
        `expected exactly one of each, so a human has to decide.`,
    });
  }

  return { pairs, irregular, undatedCount };
}
