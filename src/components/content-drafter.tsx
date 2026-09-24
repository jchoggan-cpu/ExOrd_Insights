"use client";

import { useRef, useState } from "react";
import { DraftOrderPicker } from "@/components/draft-order-picker";
import { useSessionDrafts } from "@/components/use-session-drafts";
import { SavedDraftNotice } from "@/components/saved-draft-notice";
import { ExistingDraftsWarning } from "@/components/existing-drafts-warning";
import type { SharedDraft } from "@/lib/content-drafts";
import type { ContentType, ExecutiveOrderListItem } from "@/lib/types";
import { REQUEST_TOKEN_HEADER } from "@/lib/request-token-header";
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
  initialSelectedIds,
  existingDrafts = [],
  requestToken,
}: {
  orders: ExecutiveOrderListItem[];
  /**
   * Orders ticked on the tracker and carried here by its selection bar, as
   * repeated eoId parameters. Several, not one: drafting from a handful of
   * related orders is the point of the multi-EO support below.
   */
  initialSelectedIds?: string[];
  /** Everything already written, so the drafter can say when this would be a duplicate. */
  existingDrafts?: SharedDraft[];
  /**
   * Minted per page render by the server (see src/lib/request-token.ts);
   * expires after 12 hours, at which point the page must be reloaded. Null
   * when REQUEST_TOKEN_SECRET isn't configured — the page still renders and
   * the order list still works, but generating is disabled rather than
   * failing with an opaque 401.
   */
  requestToken: string | null;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? []),
  );
  const [contentType, setContentType] = useState<ContentType>("client_alert");
  const [draftText, setDraftText] = useState("");
  const [isStub, setIsStub] = useState(false);
  const [unverifiedQuotes, setUnverifiedQuotes] = useState<string[]>([]);
  const [quotesWereChecked, setQuotesWereChecked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /**
   * What the last successful generation produced, for the notice beside the
   * button. The draft itself renders below the fold, so without this a
   * reader has no sign anything happened.
   */
  const [lastGenerated, setLastGenerated] = useState<{ type: ContentType; at: Date } | null>(null);
  const draftSectionRef = useRef<HTMLElement>(null);
  /** The id of the draft just generated, while this session can still delete it. */
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const { remember } = useSessionDrafts();
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
    if (!requestToken) {
      setError("Content drafting is disabled because this deployment has no REQUEST_TOKEN_SECRET set (see README).");
      return;
    }
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
        headers: { "Content-Type": "application/json", [REQUEST_TOKEN_HEADER]: requestToken },
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
      setLastGenerated({ type: contentType, at: new Date() });
      // Saved for the team automatically. The id and its delete token are
      // kept for this session so the author can take it back down again.
      if (typeof data.draftId === "string" && typeof data.deleteToken === "string") {
        remember({ id: data.draftId, deleteToken: data.deleteToken });
        setSavedDraftId(data.draftId);
      } else {
        setSavedDraftId(null);
      }
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
      <DraftOrderPicker orders={orders} selectedIds={selectedIds} onToggle={toggleSelected} />

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
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-foreground hover:border-brand"
              }`}
            >
              {CONTENT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </section>

      <ExistingDraftsWarning
        drafts={existingDrafts}
        selectedIds={Array.from(selectedIds)}
        contentType={contentType}
      />

      <section className="flex flex-wrap items-center gap-y-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !requestToken}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate draft"}
        </button>
        {/* The draft lands below the fold, so say it is there and offer to
            go to it. Scrolling on its own would move the page under someone
            mid-sentence in the order list. */}
        {lastGenerated && !generating && (
          <button
            type="button"
            onClick={() =>
              draftSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="ml-3 inline-flex items-center gap-2 rounded border border-success/40 bg-success/10 px-3 py-2 text-sm text-success hover:bg-success/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span aria-hidden="true">&#10003;</span>
            <span>
              {CONTENT_TYPE_LABELS[lastGenerated.type]} ready &middot;{" "}
              {lastGenerated.at.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span className="font-medium underline">View draft</span>
            <span aria-hidden="true">&darr;</span>
          </button>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </section>

      {draftText && (
        <section ref={draftSectionRef} className="scroll-mt-4">
          <h2 className="font-display text-lg font-semibold text-foreground">3. Review & export</h2>

          {savedDraftId && (
            <SavedDraftNotice
              draftId={savedDraftId}
              onDeleted={() => setSavedDraftId(null)}
              onError={setError}
            />
          )}
          {isStub && (
            <p className="mt-2 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-xs text-primary">
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
            <p className="mt-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
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
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>
            <button
              type="button"
              onClick={handleExportDocx}
              disabled={!reviewed}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export as .docx
            </button>
            <button
              type="button"
              onClick={handleExportMarkdown}
              disabled={!reviewed}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export as text/markdown
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
