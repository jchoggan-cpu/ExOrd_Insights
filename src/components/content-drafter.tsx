"use client";

import { useState } from "react";
import type { ContentType, ExecutiveOrderListItem } from "@/lib/types";
import { CONTENT_TYPE_LABELS } from "@/lib/types";

const CONTENT_TYPES = Object.keys(CONTENT_TYPE_LABELS) as ContentType[];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ContentDrafter({
  orders,
  initialSelectedId,
}: {
  orders: ExecutiveOrderListItem[];
  initialSelectedId?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialSelectedId ? [initialSelectedId] : []),
  );
  const [contentType, setContentType] = useState<ContentType>("client_alert");
  const [draftText, setDraftText] = useState("");
  const [isStub, setIsStub] = useState(false);
  const [unverifiedQuotes, setUnverifiedQuotes] = useState<string[]>([]);
  const [quotesWereChecked, setQuotesWereChecked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reviewed, setReviewed] = useState(false);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (selectedIds.size === 0) {
      setError("Select at least one executive order first.");
      return;
    }
    setGenerating(true);
    setError(null);
    setCopied(false);
    setReviewed(false);
    setUnverifiedQuotes([]);
    setQuotesWereChecked(false);
    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eoIds: Array.from(selectedIds), contentType }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate content.");
      }
      setDraftText(data.draftText);
      setIsStub(Boolean(data.isStub));
      setUnverifiedQuotes(Array.isArray(data.unverifiedQuotes) ? data.unverifiedQuotes : []);
      setQuotesWereChecked(Boolean(data.quotesWereChecked));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate content.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(draftText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleExportMarkdown() {
    const blob = new Blob([draftText], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `${contentType}-draft.md`);
  }

  async function handleExportDocx() {
    const { Document, Packer, Paragraph } = await import("docx");
    const doc = new Document({
      sections: [
        {
          children: draftText
            .split("\n")
            .map((line) => new Paragraph(line)),
        },
      ],
    });
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${contentType}-draft.docx`);
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-display text-lg font-semibold text-foreground">
          1. Select executive order(s)
        </h2>
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface">
          {orders.map((eo) => (
            <label
              key={eo.id}
              className="flex cursor-pointer items-start gap-3 border-b border-border/60 px-4 py-2.5 text-sm last:border-0 hover:bg-background/50"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(eo.id)}
                onChange={() => toggleSelected(eo.id)}
                className="mt-0.5"
              />
              <span>
                <span className="font-mono text-xs text-muted">
                  {eo.eoNumber ?? eo.actionType ?? "—"}
                </span>{" "}
                <span className="font-medium">{eo.title}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          Select more than one to generate a combined digest across related orders.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-foreground">
          2. Choose content type
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {CONTENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setContentType(type)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                contentType === type
                  ? "border-accent-strong bg-accent-strong text-white"
                  : "border-border bg-surface text-foreground hover:border-accent"
              }`}
            >
              {CONTENT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-md bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate draft"}
        </button>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </section>

      {draftText && (
        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">3. Review & export</h2>
          {isStub && (
            <p className="mt-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-strong">
              This is a placeholder stub draft — set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY to enable real AI-generated
              content (see README).
            </p>
          )}
          {unverifiedQuotes.length > 0 && (
            <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <p className="font-medium">
                {unverifiedQuotes.length} quoted passage{unverifiedQuotes.length > 1 ? "s" : ""} could not be
                verified against the source order&apos;s text — check these carefully before relying on them:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {unverifiedQuotes.map((quote, i) => (
                  <li key={i}>&ldquo;{quote}&rdquo;</li>
                ))}
              </ul>
            </div>
          )}
          {!isStub && unverifiedQuotes.length === 0 && !quotesWereChecked && (
            <p className="mt-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
              Quote verification wasn&apos;t possible — the selected order(s) don&apos;t have stored source text
              yet (pre-Federal Register ingestion). This is not a confirmation that any quotes are accurate.
            </p>
          )}
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={16}
            className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-link"
          />
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I have reviewed this draft for accuracy and it is ready to use. AI-generated
              content can contain errors — export is disabled until this is checked.
            </span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!reviewed}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>
            <button
              type="button"
              onClick={handleExportDocx}
              disabled={!reviewed}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export as .docx
            </button>
            <button
              type="button"
              onClick={handleExportMarkdown}
              disabled={!reviewed}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export as text/markdown
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
