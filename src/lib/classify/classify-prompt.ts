import { INDUSTRIES, PRACTICE_AREAS } from "@/lib/taxonomy";

/**
 * Builds the system prompt for classification-only runs.
 *
 * Separate from the summarization prompt on purpose. Classification is
 * currently welded into summarize.ts, so the only way to re-tag a row would
 * be to re-summarize it — which would overwrite the firm's 338 curated
 * summaries. This prompt asks for the tags and nothing else.
 *
 * The prompt is built from src/config/practice-areas.json and
 * industries.json, so editing the firm's lists changes the prompt with no
 * code change.
 */

/**
 * Identical on every call and large enough to be worth caching, exactly as
 * the summarization prompt is — see summarizeDocument's note on why a silent
 * caching failure doubles the bill.
 */
export function buildClassifyPrompt(): string {
  const practiceAreaLines = PRACTICE_AREAS.map(
    (area) => `- ${area.name}: ${area.criteria ?? "(no criteria given)"}`,
  ).join("\n");

  return `You classify U.S. presidential executive orders, proclamations and memoranda for a law firm's internal tracker. You assign two kinds of tag and write nothing else.

PRACTICE AREAS — the firm's practice groups. Select every group that would plausibly need to advise a client because of this instrument. The test for each:

${practiceAreaLines}

INDUSTRIES — the sectors materially affected. Select only those the instrument actually reaches, not every sector touched in passing:

${INDUSTRIES.map((industry) => `- ${industry}`).join("\n")}

HOW TO DECIDE

- Judge the instrument by what it does, not what it is called. An order about "national security" that conditions federal grant money is Governmental; one that imposes export controls is Global Reach.
- Most instruments engage more than one practice group. Select every group that genuinely applies rather than only the single closest one.
- Do not select a group merely because a topic is mentioned. The instrument must do something a lawyer in that group would act on.
- An empty list is a legitimate answer when nothing applies, but it should be rare for practice areas — a presidential instrument that no practice group would advise on is unusual.
- Use only the exact names listed above. Do not invent, abbreviate or rephrase a name.

Respond with JSON and nothing else, in exactly this shape:

{"practiceAreas": ["..."], "industries": ["..."]}`;
}
