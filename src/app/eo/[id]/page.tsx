import Link from "next/link";
import { notFound } from "next/navigation";
import { getExecutiveOrderById, isUsingLocalData } from "@/lib/data";
import { StatusBadge } from "@/components/status-badge";
import { TagPill } from "@/components/tag-pill";
import { LocalDataBanner } from "@/components/local-data-banner";
import { NeedsReviewBadge } from "@/components/needs-review-badge";

function formatDate(iso: string | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

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
            <p className="font-mono text-xs text-muted">{eo.eoNumber ?? eo.actionType ?? "—"}</p>
            <h1 className="font-display mt-1 text-2xl font-semibold text-foreground">
              {eo.title}
            </h1>
            <div className="mt-2 flex items-center gap-3">
              <StatusBadge status={eo.status} />
              <span className="text-sm text-muted">Signed {formatDate(eo.dateSigned)}</span>
              {eo.needsReview && <NeedsReviewBadge reason={eo.needsReviewReason} />}
            </div>
          </div>
          <Link
            href={`/draft?eoId=${eo.id}`}
            className="whitespace-nowrap rounded-md bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Draft content about this EO
          </Link>
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
          </Section>

          <Section title="Agencies Impacted">
            {eo.agenciesImpacted.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {eo.agenciesImpacted.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None recorded.</p>
            )}
          </Section>

          <Section title="Key Dates">
            {eo.keyDates.length > 0 ? (
              <ul className="space-y-1">
                {eo.keyDates.map((kd) => (
                  <li key={kd.label} className="flex justify-between gap-4 border-b border-border/60 py-1 last:border-0">
                    <span>{kd.label}</span>
                    <span className="whitespace-nowrap text-muted">{formatDate(kd.date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None recorded.</p>
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
                      <span className="text-xs text-muted">{lc.status}</span>
                    </div>
                    <p className="mt-1 text-muted">{lc.court}</p>
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
              <p className="text-muted">No known legal challenges.</p>
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
                      <span className="text-xs text-muted">{formatDate(n.date)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{n.source}</p>
                    <p className="mt-2">{n.snippet}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No news coverage on file.</p>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
