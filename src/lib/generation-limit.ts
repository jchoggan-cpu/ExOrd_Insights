import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A ceiling on how many content generations can happen in an hour.
 *
 * The request token on `/api/generate-content` stops scrapers, not people
 * (see request-token.ts). This is the part that actually bounds the bill if
 * somebody extracts a token: the token decides *who* may call, this decides
 * *how much* calling can cost.
 *
 * Deliberately global rather than per-caller. The goal is a ceiling on spend,
 * which is a property of the whole deployment, not of one visitor — and it
 * needs no new table and stores no visitor identifiers, because every model
 * call is already recorded in `api_usage`. The cost is that one runaway
 * caller blocks everyone until the window rolls over, which is the right
 * trade for a tool with one or two real users.
 *
 * Not a substitute for the monthly cap on the Anthropic account. That is
 * still the real backstop; this just stops a loop exhausting it in an hour.
 */

/**
 * Each generation is a Claude Opus 5 call over full order text, roughly
 * $0.10–$0.30. Twenty an hour is far more drafting than a person does — you
 * would need a finished draft every three minutes to notice it — while
 * capping a runaway at a few dollars an hour instead of nothing at all.
 */
export const CONTENT_GENERATIONS_PER_HOUR = 20;

export const GENERATION_WINDOW_MS = 60 * 60 * 1000;

/** The `feature` value `recordApiUsage` writes for content drafting — what this counts. */
const CONTENT_FEATURE = "content";

export type LimitDecision =
  | { allowed: true; used: number }
  | { allowed: false; used: number; retryAfterSeconds: number };

/**
 * Pure: given how many generations happened in the window, decide. Split out
 * from the query so the rule is testable without a database.
 */
export function decideFromCount(usedInWindow: number): LimitDecision {
  if (usedInWindow < CONTENT_GENERATIONS_PER_HOUR) {
    return { allowed: true, used: usedInWindow };
  }
  // A whole window, because the count is not timestamp-ordered here — this
  // is a cooling-off period, not a precise "when does the oldest call age
  // out". Honest and slightly conservative beats precise and complicated.
  return {
    allowed: false,
    used: usedInWindow,
    retryAfterSeconds: Math.ceil(GENERATION_WINDOW_MS / 1000),
  };
}

/**
 * Counts content generations recorded in the trailing window.
 *
 * Counts only *billed* calls, since `recordApiUsage` writes after the model
 * responds — a request that failed before reaching the model cost nothing and
 * correctly does not consume the budget.
 */
async function countRecentGenerations(supabase: SupabaseClient, since: Date): Promise<number | null> {
  const { count, error } = await supabase
    .from("api_usage")
    .select("id", { count: "exact", head: true })
    .eq("feature", CONTENT_FEATURE)
    .gte("created_at", since.toISOString());

  if (error) {
    // Reported, not swallowed (rule 4) — and deliberately non-fatal. A
    // Supabase blip must not take content drafting down for a tool one
    // person uses; the monthly Anthropic cap is still in force underneath.
    // The trade is explicit: during an outage the hourly ceiling is not
    // enforced, and this line is how you find out that happened.
    console.error(
      `Generation rate-limit check failed, so the ${CONTENT_GENERATIONS_PER_HOUR}/hour ceiling is NOT being enforced right now:`,
      error.message,
    );
    return null;
  }
  return count ?? 0;
}

/**
 * The one call a route handler needs. `supabase` is injected (rule 3) so this
 * is testable without a real database.
 *
 * Note the check and the call are not atomic: several requests arriving
 * together can each read a count below the ceiling and all proceed. At one or
 * two users that overshoot is a request or two, not a budget.
 */
export async function checkGenerationLimit(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<LimitDecision> {
  const used = await countRecentGenerations(supabase, new Date(now.getTime() - GENERATION_WINDOW_MS));
  if (used === null) return { allowed: true, used: 0 };
  return decideFromCount(used);
}

export function limitMessage(decision: Extract<LimitDecision, { allowed: false }>): string {
  const minutes = Math.ceil(decision.retryAfterSeconds / 60);
  return (
    `This tool is limited to ${CONTENT_GENERATIONS_PER_HOUR} content generations an hour and has used ` +
    `${decision.used}. Try again in up to ${minutes} minutes.`
  );
}
