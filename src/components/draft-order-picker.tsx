"use client";

import { useState } from "react";
import { INDUSTRIES, PRACTICE_AREAS, SUBJECT_AREAS, subPracticeTag } from "@/lib/taxonomy";
import { MultiSelectFilter, type FilterOption } from "@/components/multi-select-filter";
import {
  filterPickerOrders,
  hasPickerFilters,
  NO_PICKER_FILTERS,
  type PickerFilters,
} from "@/lib/filter-picker-orders";
import { STATUSES } from "@/lib/tracker-query";
import type { ExecutiveOrderListItem } from "@/lib/types";

/**
 * Choosing which orders to draft from, with the same kinds of filter the
 * tracker offers.
 *
 * Filtering happens in the browser over the list the page already carries,
 * so nothing navigates and a selection cannot be lost mid-search. The cost
 * is reach: this can only match what a list row holds -- title, number,
 * summary and tags -- where the tracker's search reads the full text of
 * every order in Postgres. The note under the box says so rather than
 * leaving a reader to discover it.
 */

const SUBJECT_OPTIONS: FilterOption[] = SUBJECT_AREAS.map((name) => ({ value: name, label: name }));

const PRACTICE_AREA_OPTIONS: FilterOption[] = PRACTICE_AREAS.flatMap((area) => [
  { value: area.name, label: area.name },
  ...(area.subPractices ?? [])
    .filter((sub) => sub.criteria)
    .map((sub) => ({
      value: subPracticeTag(area.name, sub.name),
      label: sub.name,
      isSubOption: true,
    })),
]);

const INDUSTRY_OPTIONS: FilterOption[] = INDUSTRIES.map((name) => ({ value: name, label: name }));

const CONTROL_CLASS =
  "rounded border border-control-border bg-surface px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function DraftOrderPicker({
  orders,
  selectedIds,
  onToggle,
}: {
  orders: ExecutiveOrderListItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [filters, setFilters] = useState<PickerFilters>(NO_PICKER_FILTERS);

  const change = (patch: Partial<PickerFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const visible = filterPickerOrders(orders, filters, selectedIds);
  const filtering = hasPickerFilters(filters);

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-foreground">
        1. Select executive order(s)
      </h2>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="draft-order-search" className="sr-only">
            Search the orders below
          </label>
          <input
            id="draft-order-search"
            type="search"
            value={filters.search}
            onChange={(e) => change({ search: e.target.value })}
            placeholder="Search titles, numbers and summaries"
            className={`w-full max-w-xs ${CONTROL_CLASS}`}
          />

          <MultiSelectFilter
            label="Subjects"
            emptyLabel="All Subjects"
            options={SUBJECT_OPTIONS}
            selected={filters.subjects}
            onChange={(subjects) => change({ subjects })}
            findPlaceholder="Find a subject"
          />

          <MultiSelectFilter
            label="Practice areas"
            emptyLabel="All Practice Areas"
            options={PRACTICE_AREA_OPTIONS}
            selected={filters.practiceAreas}
            onChange={(practiceAreas) => change({ practiceAreas })}
            findPlaceholder="Find a practice area"
          />

          <MultiSelectFilter
            label="Industries"
            emptyLabel="All Industries"
            options={INDUSTRY_OPTIONS}
            selected={filters.industries}
            onChange={(industries) => change({ industries })}
            findPlaceholder="Find an industry"
          />

          <select
            value={filters.status}
            onChange={(e) => change({ status: e.target.value })}
            aria-label="Filter by status"
            className={CONTROL_CLASS}
          >
            <option value="">All Statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status[0].toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>

          {filtering && (
            <button
              type="button"
              onClick={() => setFilters(NO_PICKER_FILTERS)}
              className="text-sm text-link hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {filtering
            ? `Showing ${visible.length.toLocaleString()} of ${orders.length.toLocaleString()} orders`
            : `${orders.length.toLocaleString()} orders`}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          {" · searches titles, numbers and summaries, not the full text of each order"}
        </p>
      </div>

      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface">
        {visible.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No orders match these filters.
          </p>
        )}

        {visible.map((eo) => (
          <label
            key={eo.id}
            className="flex cursor-pointer items-start gap-3 border-b border-border/60 px-4 py-2.5 text-sm last:border-0 hover:bg-background/50"
          >
            <input
              type="checkbox"
              checked={selectedIds.has(eo.id)}
              onChange={() => onToggle(eo.id)}
              className="mt-0.5"
            />
            <span>
              <span className="font-mono text-xs text-muted-foreground">
                {eo.eoNumber ?? eo.actionType ?? "—"}
              </span>{" "}
              <span className="font-medium">{eo.title}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Select more than one to generate a combined digest across related orders.
      </p>
    </section>
  );
}
