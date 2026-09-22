import Link from "next/link";
import { notFound } from "next/navigation";
import { getExecutiveOrderById, isUsingLocalData } from "@/lib/data";
import { getSummaryDraft } from "@/lib/summary-drafts";
import { SummaryDraftPanel } from "@/components/summary-draft-panel";
import { StatusBadge } from "@/components/status-badge";
import { TagPill } from "@/components/tag-pill";
import { LocalDataBanner } from "@/components/local-data-banner";
import { NeedsReviewBadge } from "@/components/needs-review-badge";
import { PriorAdministrationBadge } from "@/components/prior-administration-badge";
import { formatDate } from "@/lib/format-date";
import { isPriorAdministrationHoldover } from "@/lib/federal-register/prior-administration";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-6 first:border-0 first:pt-0">
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default async function EoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eo = await getExecutiveOrderById(id);
  if (!eo) notFound();

  // A draft, when one exists, is shown beneath the summary rather than in
  // place of it — see SummaryDraftPanel.
  const draft = await getSummaryDraft(id);

  const usingLocalData = isUsingLocalData();

  return (
    <main className="flex flex-1 flex-col">
      {usingLocalData && <LocalDataBanner />}
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <Link href="/" className="text-sm text-link hover:underline">
          ← Back to tracker
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-muted-foreground">{eo.eoNumber ?? eo.actionType ?? "—"}</p>
            <h1 className="font-display mt-1 text-2xl font-semibold text-foreground">
              {eo.title}
            </h1>
            <div className="mt-2 flex items-center gap-3">
              <StatusBadge status={eo.status} />
              <span className="text-sm text-muted-foreground">Signed {formatDate(eo.dateSigned, "long")}</span>
              {eo.needsReview && <NeedsReviewBadge reason={eo.needsReviewReason} />}
              {isPriorAdministrationHoldover(eo.dateSigned) && (
                <PriorAdministrationBadge dateSigned={eo.dateSigned} />
              )}
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <Link
              href={`/draft?eoId=${eo.id}`}
              className="whitespace-nowrap rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90"
            >
              Draft content about this EO
            </Link>

            {/*
              Everything above this line is the firm's own work product or an
              AI summary of the order. This is the order. Named for what it
              actually is: federal_register_url holds the API's html_url, the
              FederalRegister.gov document page -- NOT the govinfo.gov PDF
              that is the official legal edition, which this database does not
              store. Calling it "the official text" would be a claim the data
              cannot support. The document page links the official PDF itself.
            */}
            {eo.federalRegisterUrl && (
              <a
                href={eo.federalRegisterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap rounded-md border border-border px-4 py-2 text-center text-sm font-medium text-link hover:border-link"
              >
                Read it on FederalRegister.gov
              </a>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-1.5">
          {eo.subjectArea.map((s) => (
            <TagPill key={s} label={s} kind="subject" />
          ))}
          {eo.practiceAreas.map((p) => (
            <TagPill key={p} label={p} kind="practice" />
          ))}
          {eo.industries.map((i) => (
            <TagPill key={i} label={i} kind="industry" />
          ))}
        </div>

        {eo.needsReview && (
          <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            ⚠ {eo.needsReviewReason}
          </div>
        )}

        <div className="mt-2">
          <Section title="Summary">
            <p>{eo.aiSummary ?? "No AI summary generated yet."}</p>
            {draft && (
              <div className="mt-4">
                <SummaryDraftPanel draft={draft} hasCuratedSummary={Boolean(eo.aiSummary)} />
              </div>
            )}
          </Section>

          <Section title="Agencies Impacted">
            {eo.agenciesImpacted.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {eo.agenciesImpacted.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">None recorded.</p>
            )}
          </Section>

          <Section title="Key Dates">
            {eo.keyDates.length > 0 ? (
              <ul className="space-y-1">
                {eo.keyDates.map((kd) => (
                  <li key={kd.label} className="flex justify-between gap-4 border-b border-border/60 py-1 last:border-0">
                    <span>{kd.label}</span>
                    <span className="whitespace-nowrap text-muted-foreground">{formatDate(kd.date, "long")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">None recorded.</p>
            )}
          </Section>

          <Section title="Timeline">
            <p>{eo.timelineNotes ?? "Not recorded."}</p>
          </Section>

          <Section title="Deliverable">
            <p>{eo.deliverable ?? "Not recorded."}</p>
          </Section>

          <Section title="Available Analysis">
            <p>{eo.availableAnalysis ?? "None on file."}</p>
          </Section>

          <Section title="Legal Challenges">
            {eo.legalChallenges.length > 0 ? (
              <ul className="space-y-4">
                {eo.legalChallenges.map((lc) => (
                  <li key={lc.caseName} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{lc.caseName}</span>
                      <span className="text-xs text-muted-foreground">{lc.status}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{lc.court}</p>
                    <p className="mt-2">{lc.summary}</p>
                    {lc.docketUrl && (
                      <a
                        href={lc.docketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-xs text-link hover:underline"
                      >
                        View docket →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No known legal challenges.</p>
            )}
          </Section>

          <Section title="News Coverage">
            {eo.newsMentions.length > 0 ? (
              <ul className="space-y-4">
                {eo.newsMentions.map((n) => (
                  <li key={n.url} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-link hover:underline"
                      >
                        {n.title}
                      </a>
                      <span className="text-xs text-muted-foreground">{formatDate(n.date, "long")}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{n.source}</p>
                    <p className="mt-2">{n.snippet}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No news coverage on file.</p>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
