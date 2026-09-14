/**
 * Expands federal agency acronyms in a case name into candidate CourtListener
 * search queries. One job: the firm's spreadsheet writes captions with
 * acronyms ("FBI Agents Association et al v. DOJ"); CourtListener's dockets
 * spell agencies out ("FEDERAL BUREAU OF INVESTIGATION AGENTS ASSOCIATION v.
 * DEPARTMENT OF JUSTICE", docket 1:25-cv-00328, D.D.C.). Exact-name matching
 * against the recorded caption never finds that docket, so match-case.ts (or
 * whatever issues the CourtListener search) needs extra candidate strings
 * built from the expansions below, alongside the original caption.
 *
 * Deciding which expansion (if any) is the right docket is not this file's
 * job — it only proposes candidates for a caller to search and score.
 */

/**
 * Formal names as they actually appear in federal court captions, not the
 * agency's own preferred long-form name — e.g. courts write "United States
 * Department of Agriculture" (not "U.S. Department of Agriculture"), and
 * "Department of Justice" (not "United States Department of Justice").
 */
const AGENCY_ABBREVIATIONS: Record<string, string> = {
  DHS: "Department of Homeland Security",
  DOJ: "Department of Justice",
  EPA: "Environmental Protection Agency",
  HHS: "Department of Health and Human Services",
  DOD: "Department of Defense",
  DOL: "Department of Labor",
  DOE: "Department of Energy",
  DOT: "Department of Transportation",
  HUD: "Department of Housing and Urban Development",
  IRS: "Internal Revenue Service",
  SEC: "Securities and Exchange Commission",
  FTC: "Federal Trade Commission",
  FCC: "Federal Communications Commission",
  NLRB: "National Labor Relations Board",
  OPM: "Office of Personnel Management",
  OMB: "Office of Management and Budget",
  GSA: "General Services Administration",
  SSA: "Social Security Administration",
  VA: "Department of Veterans Affairs",
  USDA: "United States Department of Agriculture",
  FBI: "Federal Bureau of Investigation",
  ICE: "Immigration and Customs Enforcement",
  CBP: "Customs and Border Protection",
  USCIS: "United States Citizenship and Immigration Services",
  NIH: "National Institutes of Health",
  CDC: "Centers for Disease Control and Prevention",
  FDA: "Food and Drug Administration",
  NSF: "National Science Foundation",
  NASA: "National Aeronautics and Space Administration",
  FEMA: "Federal Emergency Management Agency",
  ATF: "Bureau of Alcohol, Tobacco, Firearms and Explosives",
  DEA: "Drug Enforcement Administration",
  TSA: "Transportation Security Administration",
  SBA: "Small Business Administration",
  EEOC: "Equal Employment Opportunity Commission",
  FEC: "Federal Election Commission",
  NRC: "Nuclear Regulatory Commission",
  CFPB: "Consumer Financial Protection Bureau",
  FDIC: "Federal Deposit Insurance Corporation",
  OCC: "Office of the Comptroller of the Currency",
  USTR: "Office of the United States Trade Representative",
  ODNI: "Office of the Director of National Intelligence",
  NARA: "National Archives and Records Administration",
  // Not a legal entity of its own — created by executive order, sued as a
  // component of the agencies it operates within — but the firm's
  // spreadsheet uses it as a party name, so it needs an expansion too.
  DOGE: "Department of Government Efficiency",
};

/**
 * Matches any key of AGENCY_ABBREVIATIONS as a whole word. Built once from
 * the map's own keys (rather than hand-written) so adding an abbreviation
 * above can never drift out of sync with what this actually matches.
 *
 * Deliberately case-SENSITIVE (no "i" flag), matching only the exact
 * upper-case spelling each key is written in above. This is the whole
 * reason "DOE" expands inside "Nat'l Ass'n v. DOE" but "Doe" never expands
 * inside "Doe v. Noem" — the firm's data has far more "Doe v." cases (the
 * common Jane/John Doe litigation pseudonym) than Department of Energy
 * cases, and title-cased "Doe" is indistinguishable from the acronym under
 * case-insensitive matching. Real captions write agency acronyms in caps
 * ("DOJ", "DHS"), so requiring the exact upper-case form loses essentially
 * no real matches while ruling out this specific false positive.
 */
const ABBREVIATION_PATTERN = new RegExp(`\\b(${Object.keys(AGENCY_ABBREVIATIONS).join("|")})\\b`, "g");

/**
 * Upper bound on candidates returned by expandAgencyAbbreviations. A case
 * name naming several agencies (rare, but the firm's data has multi-agency
 * captions) could otherwise produce one candidate per abbreviation combined
 * with every other — this caps it so a pathological caption can't blow up
 * the number of CourtListener searches a caller issues.
 */
const MAX_CANDIDATES = 8;

/**
 * Returns candidate expanded forms of `caseName`, one per abbreviation found
 * plus (when there are two or more) one candidate with all of them expanded
 * together, capped at MAX_CANDIDATES. Does not include the original
 * `caseName`. Returns [] when no known abbreviation appears as a whole word
 * in its exact upper-case form (see ABBREVIATION_PATTERN for why case
 * sensitivity matters here).
 */
export function expandAgencyAbbreviations(caseName: string): string[] {
  if (!caseName) return [];

  const matches = [...caseName.matchAll(ABBREVIATION_PATTERN)];
  if (matches.length === 0) return [];

  // De-dupe: "DOJ ... DOJ" should only produce one single-substitution
  // candidate, not two identical ones.
  const uniqueAbbreviations = Array.from(new Set(matches.map((match) => match[0])));

  const candidates: string[] = [];

  // One candidate per abbreviation, expanding only that one occurrence
  // (all occurrences of that same abbreviation, so "DOJ v. DOJ" style
  // captions stay internally consistent).
  for (const abbreviation of uniqueAbbreviations) {
    candidates.push(expandOnly(caseName, abbreviation));
  }

  // When several distinct abbreviations appear, also offer the fully
  // expanded caption, since that's most likely to match a CourtListener
  // caption that spells everything out.
  if (uniqueAbbreviations.length > 1) {
    candidates.push(expandAll(caseName));
  }

  // De-dupe defensively: with exactly two distinct abbreviations, expanding
  // "both together" and expanding "the second one only" can coincide with
  // the "first one only" candidate's sibling, producing an identical string
  // through two different code paths.
  const deduped = Array.from(new Set(candidates));

  return deduped.slice(0, MAX_CANDIDATES);
}

/** Replaces every occurrence of one specific abbreviation, leaves the rest untouched. */
function expandOnly(caseName: string, abbreviation: string): string {
  const fullName = AGENCY_ABBREVIATIONS[abbreviation];
  const singleAbbreviationPattern = new RegExp(`\\b${abbreviation}\\b`, "g");
  return caseName.replace(singleAbbreviationPattern, fullName);
}

/** Replaces every known abbreviation found in the case name with its full form. */
function expandAll(caseName: string): string {
  return caseName.replace(ABBREVIATION_PATTERN, (match) => AGENCY_ABBREVIATIONS[match]);
}

export { AGENCY_ABBREVIATIONS };
