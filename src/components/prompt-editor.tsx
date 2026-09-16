"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REQUEST_TOKEN_HEADER } from "@/lib/request-token-header";

interface PromptEditorProps {
  initialBody: string;
  defaultBody: string;
  isDefault: boolean;
  /** The rendered prompt as the model actually receives it, with the taxonomy lists substituted. */
  renderedPreview: string;
  /** Minted per page render by the server (see src/lib/request-token.ts); expires after 12 hours. Null when REQUEST_TOKEN_SECRET isn't configured, which disables saving rather than failing with an opaque 401. */
  requestToken: string | null;
}

type SaveState = { status: "idle" | "saving" } | { status: "error"; messages: string[] } | { status: "saved"; warnings: string[] };

export function PromptEditor({
  initialBody,
  defaultBody,
  isDefault,
  renderedPreview,
  requestToken,
}: PromptEditorProps) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [note, setNote] = useState("");
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [showPreview, setShowPreview] = useState(false);

  const isDirty = body !== initialBody;

  async function handleSave() {
    if (!requestToken) {
      setSave({ status: "error", messages: ["Saving is disabled because this deployment has no REQUEST_TOKEN_SECRET set (see README)."] });
      return;
    }
    setSave({ status: "saving" });
    try {
      const response = await fetch("/api/summary-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", [REQUEST_TOKEN_HEADER]: requestToken },
        body: JSON.stringify({ body, note }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setSave({ status: "error", messages: payload.errors ?? [payload.error ?? "Saving failed."] });
        return;
      }

      setSave({ status: "saved", warnings: payload.warnings ?? [] });
      setNote("");
      // Re-runs the server component so the history list and the "in force"
      // banner reflect the version just saved.
      router.refresh();
    } catch (err) {
      setSave({ status: "error", messages: [err instanceof Error ? err.message : "Saving failed."] });
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">
            {isDefault ? "Built-in default (nothing saved yet)" : "Active prompt"}
          </span>
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-link hover:underline"
            >
              {showPreview ? "Hide" : "Show"} what the model receives
            </button>
            <button
              type="button"
              onClick={() => setBody(defaultBody)}
              disabled={body === defaultBody}
              className="text-link hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
            >
              Reset to default
            </button>
          </div>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          rows={28}
          className="w-full resize-y bg-transparent px-4 py-3 font-mono text-xs leading-relaxed text-foreground outline-none"
          aria-label="Summarization prompt"
        />
      </div>

      {showPreview && (
        <div className="rounded-lg border border-border bg-surface">
          <p className="border-b border-border px-4 py-2.5 text-sm text-muted">
            The saved prompt with the firm&apos;s taxonomy lists substituted in — this exact text is
            sent as the system prompt. Editing above changes the template; the lists themselves come
            from <code className="font-mono text-xs">src/config/</code>.
          </p>
          <pre className="max-h-96 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">
            {renderedPreview}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What changed, and why (optional)"
          className="min-w-64 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-link"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || save.status === "saving" || !requestToken}
          className="rounded-md bg-accent-strong px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.status === "saving" ? "Saving…" : "Save as new version"}
        </button>
        {isDirty && save.status !== "saving" && (
          <span className="text-sm text-muted">Unsaved changes</span>
        )}
      </div>

      {save.status === "error" && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3">
          <p className="text-sm font-medium text-danger">Not saved</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-danger">
            {save.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {save.status === "saved" && (
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-sm text-foreground">
            Saved. This prompt is now in force for the next enrichment run — existing summaries are
            not rewritten.
          </p>
          {save.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
              {save.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
