import { getSupabaseClient } from "@/lib/supabase";
import {
  listSummaryPrompts,
  loadActiveSummaryPrompt,
  type ActiveSummaryPrompt,
  type SummaryPromptVersion,
} from "@/lib/summary-prompt/store";
import { DEFAULT_SUMMARY_PROMPT } from "@/lib/summary-prompt/default-prompt";
import { renderSummaryPrompt } from "@/lib/summary-prompt/render";
import { getSummaryModel } from "@/lib/ai-model";
import { PromptEditor } from "@/components/prompt-editor";
import { formatDate } from "@/lib/format-date";
import { hasRequestTokenSecret, mintRequestToken } from "@/lib/request-token";

// Reads the live prompt and its history — never statically prerendered, or a
// prompt saved today would keep showing yesterday's text until a rebuild
// (same reasoning as src/app/page.tsx).
export const dynamic = "force-dynamic";

async function loadPromptState(): Promise<{
  active: ActiveSummaryPrompt;
  history: SummaryPromptVersion[];
  connected: boolean;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      active: { id: null, body: DEFAULT_SUMMARY_PROMPT, isDefault: true },
      history: [],
      connected: false,
    };
  }

  const [active, history] = await Promise.all([
    loadActiveSummaryPrompt(supabase),
    listSummaryPrompts(supabase),
  ]);
  return { active, history, connected: true };
}

export default async function PromptPage() {
  const { active, history, connected } = await loadPromptState();

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-foreground">Summary Prompt</h1>
          <p className="mt-1 max-w-3xl text-muted">
            The instructions sent to{" "}
            <code className="font-mono text-sm text-foreground">{getSummaryModel()}</code> for every
            executive order it summarizes and classifies. Editing this changes how future summaries
            are written — it never rewrites summaries already in the tracker, and never touches the
            firm&apos;s hand-written ones.
          </p>
        </div>

        {!connected && (
          <div className="mb-6 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
            Supabase isn&apos;t configured, so this shows the built-in default and saving is
            unavailable. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see README).
          </div>
        )}

        {connected && (
          <PromptEditor
            initialBody={active.body}
            defaultBody={DEFAULT_SUMMARY_PROMPT}
            isDefault={active.isDefault}
            renderedPreview={renderSummaryPrompt(active.body)}
            requestToken={hasRequestTokenSecret() ? mintRequestToken() : null}
          />
        )}

        {history.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Version history ({history.length})
            </h2>
            <p className="mt-1 text-sm text-muted">
              Every save is kept. A summary written on a given day was written by whichever version
              was in force then.
            </p>
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
              {history.map((version) => (
                <details key={version.id} className="border-b border-border/60 last:border-0">
                  <summary className="cursor-pointer px-4 py-3 text-sm text-foreground hover:bg-border/20">
                    <span className="font-medium">{formatDate(version.createdAt)}</span>
                    {version.isActive && (
                      <span className="ml-2 rounded-full bg-accent-strong/10 px-2 py-0.5 text-xs font-medium text-accent-strong">
                        in force
                      </span>
                    )}
                    {version.note && <span className="ml-2 text-muted">— {version.note}</span>}
                  </summary>
                  <pre className="max-h-80 overflow-auto border-t border-border/60 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">
                    {version.body}
                  </pre>
                </details>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
