// Federal Register's raw_text_url returns plain order text wrapped in a thin
// HTML shell, plus typesetting artifacts (page-break markers, running
// headers, filing-stamp boilerplate) that aren't part of the order itself.
// This strips those so the stored full_text is exactly the order's own
// words — the ground truth that quote-verify.ts checks against — nothing
// more, nothing less.

// Federal Register's raw text embeds literal NUL (code point 0) bytes as a
// typesetting artifact around page-break/masthead markers (confirmed
// present in real documents, not a hypothetical). Postgres/PostgREST cannot
// store a NUL byte in a text column at all ("unsupported Unicode escape
// sequence") -- so this must be stripped, not just the visible artifacts
// below. Other C0 control characters are stripped for the same reason (not
// part of the order's own words); tab/newline/CR (0x09/0x0A/0x0D) are
// deliberately excluded from this range and preserved.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
const HTML_TAG = /<[^>]+>/g;
// Whole-line bracket annotations, e.g. "[Pages 55995-55999]", "[FR Doc No: 2026-17843]".
const SINGLE_BRACKET_LINE = /^\[[^[\]\n]*\]\s*$/gm;
const PAGE_BREAK_MARKER = /\[\[Page \d+\]\]/g;
const GPO_BOILERPLATE_LINE = /^From the Federal Register Online.*$/gm;
// Filing-stamp footer, e.g. "[FR Doc. 2026-17843\nFiled 8-28-26; 11:15 am]" — spans two lines.
const FR_DOC_FOOTER = /\[FR Doc\.[\s\S]*?\]/g;
const BILLING_CODE_LINE = /^Billing code .*$/gm;
// The running masthead, e.g. "Federal Register / Vol. 91 , No. 167 / Monday, August 31, 2026 / Presidential Documents".
const MASTHEAD = /Federal Register\s*\/\s*Vol\.\s*\d+\s*,?\s*No\.\s*\d+\s*\/[^/]*\/\s*Presidential Documents/g;

export function cleanFederalRegisterText(raw: string): string {
  let text = raw;
  text = text.replace(CONTROL_CHARS, "");
  text = text.replace(HTML_TAG, " "); // also removes non-HTML pseudo-tags like <GRAPHIC(S) NOT AVAILABLE...>
  text = text.replace(FR_DOC_FOOTER, " ");
  text = text.replace(PAGE_BREAK_MARKER, " ");
  text = text.replace(SINGLE_BRACKET_LINE, " ");
  text = text.replace(GPO_BOILERPLATE_LINE, " ");
  text = text.replace(BILLING_CODE_LINE, " ");
  text = text.replace(MASTHEAD, " ");
  return text.replace(/\s+/g, " ").trim();
}
