/**
 * Checks the hard facts in a summary against its source document.
 *
 * quote-verify.ts only checks material inside quotation marks, which most
 * summaries don't use — 53 of the firm's 340 hand-written ones did. The
 * dangerous failure in a legal tracker isn't a misquote, it's a confident
 * wrong number: a 90-day deadline that was 60, a 50 percent tariff that was
 * 25, a citation to a section the order never mentions. Those are checkable
 * mechanically, and this does it.
 *
 * It answers "does this figure appear in the source at all", not "is it used
 * correctly" — a summary can pass here and still attach the right number to
 * the wrong actor. Treat a clean result as "nothing obviously invented",
 * never as "verified accurate".
 */

export type FactKind = "deadline" | "money" | "percentage" | "citation" | "instrument" | "date";

export interface ExtractedFact {
  kind: FactKind;
  /** As written in the summary. */
  text: string;
  /** What we search the source for — normalized, so "50%" matches "50 percent". */
  needles: string[];
}

/**
 * Federal Register prose spells deadlines out ("within sixty days") while
 * summaries render them as digits. Without this mapping every such deadline
 * looks invented — it was the single biggest source of false positives when
 * this ran over the tracker's 498 summarized rows.
 */
const SPELLED_NUMBERS: Record<number, string[]> = {
  5: ["five"], 7: ["seven"], 10: ["ten"], 14: ["fourteen"], 15: ["fifteen"],
  20: ["twenty"], 21: ["twenty-one", "twenty one"], 30: ["thirty"], 45: ["forty-five", "forty five"],
  60: ["sixty"], 90: ["ninety"], 120: ["one hundred twenty", "one hundred and twenty"],
  180: ["one hundred eighty", "one hundred and eighty"], 365: ["three hundred sixty-five"],
};

/** "$125 million" in a summary is "$125,000,000" in the source; both are the same fact. */
const MONEY_SCALES: Record<string, number> = { million: 1e6, billion: 1e9, trillion: 1e12 };

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/** Collapses the formatting differences that would otherwise look like fabrication. */
export function normalizeForFactSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/ | /g, " ")
    .replace(/,(?=\d{3}\b)/g, "") // 1,000 -> 1000, so digit runs compare equal
    // "C.F.R." / "U.S.C." vs "CFR" / "USC" is the same citation. Normalizing
    // BOTH sides here (rather than generating spellings per needle) is what
    // makes it reliable — stripping periods needle-side alone also ate the
    // decimal in "731.202(b)" and turned a correct cite into a false flag.
    .replace(/\bc\.\s?f\.\s?r\./g, "cfr")
    .replace(/\bu\.\s?s\.\s?c\./g, "usc")
    .replace(/\b(cfr|usc)\s*/g, "$1 ")
    .replace(/\s+/g, " ");
}

interface Pattern {
  kind: FactKind;
  regex: RegExp;
  /** Extra spellings of the same fact that should count as a match. */
  alternatives?: (match: RegExpMatchArray) => string[];
}

const PATTERNS: Pattern[] = [
  {
    kind: "deadline",
    regex: /\b(\d{1,4})\s+(calendar\s+|business\s+)?days?\b/gi,
    alternatives: (m) => {
      const spellings = SPELLED_NUMBERS[Number(m[1])] ?? [];
      return [
        `${m[1]} days`,
        `${m[1]}-day`,
        `${m[1]} calendar days`,
        `${m[1]} business days`,
        ...spellings.flatMap((word) => [`${word} days`, `${word}-day`, `${word} calendar days`]),
      ];
    },
  },
  {
    kind: "money",
    regex: /\$\s?([\d,]+(?:\.\d+)?)\s?(million|billion|trillion)?/gi,
    alternatives: (m) => {
      const amount = m[1].replace(/,/g, "");
      const scaleWord = m[2]?.toLowerCase();
      const forms = [`$${amount}${scaleWord ? ` ${scaleWord}` : ""}`, `$${m[1]}`, amount];
      if (scaleWord && MONEY_SCALES[scaleWord]) {
        // "$125 million" also written out as "$125,000,000" / "125000000".
        const expanded = Number(amount) * MONEY_SCALES[scaleWord];
        if (Number.isFinite(expanded)) forms.push(`$${expanded}`, String(expanded));
      }
      return forms;
    },
  },
  {
    kind: "percentage",
    regex: /\b(\d{1,3}(?:\.\d+)?)\s?(?:%|percent)\b/gi,
    alternatives: (m) => {
      const value = m[1];
      // Regulations routinely write ".15 percent"; summaries write "0.15 percent".
      const noLeadingZero = value.startsWith("0.") ? value.slice(1) : null;
      const withLeadingZero = value.startsWith(".") ? `0${value}` : null;
      return [value, noLeadingZero, withLeadingZero]
        .filter((v): v is string => v !== null)
        .flatMap((v) => [`${v}%`, `${v} percent`, `${v} per cent`]);
    },
  },
  {
    // 25 CFR part 83, 8 U.S.C. 1182, section 232. Bounded at the cite itself:
    // the earlier form ran on to the next punctuation and swallowed trailing
    // prose, so a correct citation followed by a clause ("10 U.S.C. 12302 and
    // 10 U") never matched the source and read as invented. That single bug
    // produced 18 of the 19 flags on the first run over the tracker.
    kind: "citation",
    regex: /\b(\d+\s+(?:CFR|C\.F\.R\.|U\.S\.C\.|USC)\s*(?:part\s+)?\d+(?:\.\d+)?(?:\([a-z0-9]+\))*|section\s+\d+[a-z]?(?:\([a-z0-9]+\))*)/gi,
    alternatives: (m) => {
      const raw = m[1].trim();
      const forms = [raw, raw.replace(/\./g, ""), raw.replace(/\s+/g, " ")];

      // Statutes are written one way in the source and another in a summary.
      // Federal Register prose says "section 551(4) of title 5, United States
      // Code"; a law firm's summary says "5 U.S.C. 551(4)". Both name the same
      // provision, and the reformatting is correct — desirable, even — so the
      // title-form spelling has to count as a match. Every citation flag in
      // the first audit of the tracker turned out to be exactly this.
      const usc = raw.match(/^(\d+)\s+(?:U\.S\.C\.|USC)\s*(.+)$/i);
      if (usc) {
        const [, title, section] = usc;
        forms.push(`section ${section} of title ${title}`, `section ${section}, title ${title}`);
      }
      const cfr = raw.match(/^(\d+)\s+(?:C\.F\.R\.|CFR)\s*(?:part\s+)?(.+)$/i);
      if (cfr) {
        const [, title, part] = cfr;
        forms.push(
          `section ${part} of title ${title}`,
          `${title} cfr ${part}`,
          `${title} cfr part ${part}`,
          // "the regulations at title 5, part 960, Code of Federal Regulations"
          `title ${title}, part ${part}`,
          `title ${title} part ${part}`,
        );
      }
      return forms;
    },
  },
  {
    kind: "instrument",
    regex: /\b(?:Executive Order|EO|Proclamation)\s+(\d{4,5})\b/gi,
    alternatives: (m) => [m[1]],
  },
  {
    kind: "date",
    regex: new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi"),
    alternatives: (m) => [
      `${m[1]} ${m[2]}, ${m[3]}`,
      `${m[1]} ${m[2]} ${m[3]}`,
      // Proclamations write "from sundown on May 15 to nightfall on May 16"
      // and leave the year to context; the summary supplies it. Matching the
      // bare month-and-day keeps that from reading as a fabricated date.
      `${m[1]} ${m[2]}`,
      // Federal Register frequently writes the ISO form in the body.
      `${m[3]}-${String(new Date(`${m[1]} 1, 2000`).getMonth() + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`,
    ],
  },
];

export function extractFacts(summary: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  for (const { kind, regex, alternatives } of PATTERNS) {
    for (const match of summary.matchAll(regex)) {
      const text = match[0].trim();
      const key = `${kind}:${normalizeForFactSearch(text)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const needles = [text, ...(alternatives?.(match) ?? [])].map(normalizeForFactSearch);
      facts.push({ kind, text, needles: [...new Set(needles)] });
    }
  }

  return facts;
}

/**
 * Facts in the summary that appear nowhere in the source. A fact counts as
 * present if ANY of its spellings is found, so formatting differences don't
 * masquerade as invention.
 */
export function findUnsupportedFacts(summary: string, sourceText: string): ExtractedFact[] {
  const haystack = normalizeForFactSearch(sourceText);
  return extractFacts(summary).filter((fact) => !fact.needles.some((n) => haystack.includes(n)));
}
