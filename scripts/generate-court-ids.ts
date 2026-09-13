#!/usr/bin/env node
/**
 * Regenerates src/lib/courtlistener/court-ids.json from CourtListener's own
 * /courts/ endpoint.
 *
 * Usage: npm run generate:court-ids
 *
 * Why generated rather than hand-written: the firm's spreadsheet records a
 * court as free text ("D.D.C.", "N.D. Cal."), which is precisely
 * CourtListener's own `citation_string` field. Deriving the lookup from the
 * API means the mapping is the API's truth rather than someone's memory of
 * it, and re-running this picks up new or renamed courts.
 *
 * The output is committed so the matcher stays deterministic and its tests
 * run offline with no network call. Re-run and commit the diff when a match
 * fails because a court is missing.
 */
import { writeFile } from "node:fs/promises";
import { normalizeCourtKey } from "../src/lib/courtlistener/court-codes";

const COURTS_URL = "https://www.courtlistener.com/api/rest/v4/courts/";

// Federal courts only. FD = district, F = courts of appeals, FS = special
// (Court of Federal Claims, CIT), FB = bankruptcy. State courts can't hear a
// challenge to a federal executive order, so they'd only add ambiguity.
const FEDERAL_JURISDICTIONS = ["FD", "F", "FS"] as const;

interface CourtListenerCourt {
  id: string;
  citation_string: string;
  short_name: string;
  full_name: string;
}

async function fetchJurisdiction(jurisdiction: string): Promise<CourtListenerCourt[]> {
  const courts: CourtListenerCourt[] = [];
  let url: string | null = `${COURTS_URL}?jurisdiction=${jurisdiction}&page_size=200`;

  while (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CourtListener /courts/ request failed (${response.status}): ${url}`);
    }
    const body: { results: CourtListenerCourt[]; next: string | null } = await response.json();
    courts.push(...body.results);
    url = body.next;
  }

  return courts;
}

async function main() {
  const byKey: Record<string, string> = {};
  const collisions: string[] = [];
  let total = 0;

  for (const jurisdiction of FEDERAL_JURISDICTIONS) {
    const courts = await fetchJurisdiction(jurisdiction);
    console.log(`${jurisdiction}: ${courts.length} courts`);
    for (const court of courts) {
      total++;
      // A court with no citation_string (e.g. the umbrella "U.S. District
      // Court" placeholder) can never be matched from the firm's text.
      if (!court.citation_string) continue;
      const key = normalizeCourtKey(court.citation_string);
      if (!key) continue;
      if (byKey[key] && byKey[key] !== court.id) {
        collisions.push(`${key}: ${byKey[key]} vs ${court.id}`);
        continue;
      }
      byKey[key] = court.id;
    }
  }

  if (collisions.length > 0) {
    // Not fatal, but it means two courts normalize to the same key and the
    // first one wins — worth seeing rather than silently picking one.
    console.log(`\nCollisions (first wins):\n  ${collisions.join("\n  ")}`);
  }

  const sorted = Object.fromEntries(Object.entries(byKey).sort(([a], [b]) => a.localeCompare(b)));
  const path = "src/lib/courtlistener/court-ids.json";
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${Object.keys(sorted).length} court keys (of ${total} courts) to ${path}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
