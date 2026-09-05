"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ExecutiveOrder } from "@/lib/types";
import { PRACTICE_AREA_NAMES, INDUSTRIES } from "@/lib/taxonomy";
import { StatusBadge } from "@/components/status-badge";
import { TagPill } from "@/components/tag-pill";
import { NeedsReviewBadge } from "@/components/needs-review-badge";

function formatDate(iso: string | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function EoTable({ orders }: { orders: ExecutiveOrder[] }) {
  const [search, setSearch] = useState("");
  const [practiceFilter, setPracticeFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((eo) => {
      if (q) {
        const haystack = [eo.title, eo.eoNumber, eo.actionType, eo.aiSummary, ...eo.subjectArea]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (practiceFilter && !eo.practiceAreas.includes(practiceFilter)) return false;
      if (industryFilter && !eo.industries.includes(industryFilter)) return false;
      if (statusFilter && eo.status !== statusFilter) return false;
      return true;
    });
  }, [orders, search, practiceFilter, industryFilter, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, EO number, or topic…"
          className="w-full max-w-sm rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-link"
        />
        <select
          value={practiceFilter}
          onChange={(e) => setPracticeFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-link"
        >
          <option value="">All Practice Areas</option>
          {PRACTICE_AREA_NAMES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-link"
        >
          <option value="">All Industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-link"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="amended">Amended</option>
          <option value="revoked">Revoked</option>
        </select>
        <span className="text-sm text-muted">
          {filtered.length} of {orders.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-background/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">EO Number</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Date Signed</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Practice Areas</th>
              <th className="px-4 py-3 font-medium">Industries</th>
              <th className="px-4 py-3 font-medium">Legal Challenges</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((eo) => (
              <tr key={eo.id} className="border-b border-border last:border-0 hover:bg-background/50">
                <td className="px-4 py-3 align-top font-mono text-xs text-muted">
                  {eo.eoNumber ?? eo.actionType ?? "—"}
                </td>
                <td className="px-4 py-3 align-top">
                  <Link href={`/eo/${eo.id}`} className="font-medium text-link hover:underline">
                    {eo.title}
                  </Link>
                  {eo.needsReview && (
                    <div className="mt-1">
                      <NeedsReviewBadge reason={eo.needsReviewReason} />
                    </div>
                  )}
                  {eo.subjectArea.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {eo.subjectArea.map((s) => (
                        <TagPill key={s} label={s} kind="subject" />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top whitespace-nowrap text-muted">
                  {formatDate(eo.dateSigned)}
                </td>
                <td className="px-4 py-3 align-top">
                  <StatusBadge status={eo.status} />
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {eo.practiceAreas.map((p) => (
                      <TagPill key={p} label={p} kind="practice" />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {eo.industries.map((i) => (
                      <TagPill key={i} label={i} kind="industry" />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-muted">
                  {eo.legalChallenges.length > 0 ? eo.legalChallenges.length : "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No executive orders match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
