/**
 * Turns a database "snippet" -- an excerpt with search terms wrapped in
 * sentinel markers -- into plain data a React component can map over.
 *
 * The database wraps matches in "[[hl]]...[[/hl]]" instead of HTML tags so
 * that a highlighted search result can never be mistaken for markup: nothing
 * here is ever passed to dangerouslySetInnerHTML, and nothing here ever will
 * be, because there is no HTML in the return type to inject.
 *
 * Pure and dependency-free, so it can be unit tested against strings alone,
 * without a database or a rendered component.
 */

/** Sentinel wrapping the start of a highlighted match. Named here so no caller re-types it. */
export const HIGHLIGHT_OPEN = "[[hl]]";

/** Sentinel wrapping the end of a highlighted match. */
export const HIGHLIGHT_CLOSE = "[[/hl]]";

export interface SnippetSegment {
  text: string;
  highlighted: boolean;
}

// Generic escape, not specific to these two markers -- keeps the split
// pattern correct even if the sentinels ever change to contain other
// regex-special characters.
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MARKER_PATTERN = new RegExp(
  `(${escapeForRegExp(HIGHLIGHT_OPEN)}|${escapeForRegExp(HIGHLIGHT_CLOSE)})`,
  "g",
);

/**
 * Parses a snippet into ordered segments of plain and highlighted text.
 *
 * The database is expected to emit well-formed marker pairs, but this reads
 * a value that started life as free-form document text, so it treats
 * malformed markers as a possibility to handle rather than a bug to throw
 * on -- this function must never throw:
 *
 * - An opener with no matching closer highlights through the end of the
 *   string, rather than being dropped. Dropping it would silently
 *   un-highlight a real match; running the highlight past where it should
 *   have stopped is the smaller, more visible imperfection.
 * - A closer with no open highlight to end is discarded rather than shown as
 *   literal text. It is sentinel syntax, not part of the order's text, so
 *   printing it verbatim would put a stray "[[/hl]]" in front of the reader
 *   for no benefit.
 * - A duplicate/nested opener encountered while already highlighted is a
 *   no-op: the output has no concept of nested highlights, so "restarting"
 *   one mid-match would not change what is shown, only add bookkeeping.
 *   Symmetrically, a second closer encountered while not highlighted is
 *   also a no-op, for the same reason a stray closer is.
 *
 * In every case the underlying text is preserved and returned exactly --
 * only the highlighting can come out imperfect, per the rule that losing
 * words is worse than losing a highlight.
 */
export function parseSnippet(snippet: string | null | undefined): SnippetSegment[] {
  if (!snippet) return [];

  const segments: SnippetSegment[] = [];
  let highlighted = false;

  for (const token of snippet.split(MARKER_PATTERN)) {
    if (token === HIGHLIGHT_OPEN) {
      highlighted = true;
      continue;
    }
    if (token === HIGHLIGHT_CLOSE) {
      highlighted = false;
      continue;
    }
    // A marker sitting at the very start or end of the string splits out an
    // empty string alongside it -- never emit that as a segment.
    if (!token) continue;
    segments.push({ text: token, highlighted });
  }

  return segments;
}
