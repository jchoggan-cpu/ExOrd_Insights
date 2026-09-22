"use client";

import { useState } from "react";

/**
 * A filter that allows several values at once, shown as a disclosure with
 * checkboxes.
 *
 * A native <select multiple> was the cheaper option and was rejected: it
 * needs ctrl-click to add a second value, shows about four rows at a time,
 * and gives no indication of what is selected once it loses focus. A
 * <details> disclosure needs no click-outside handling, no focus trap, and
 * no JavaScript to open, while the summary can say how many are selected.
 */

export interface FilterOption {
  value: string;
  label: string;
  /**
   * A subgroup of the option above it — e.g. "National Security" under
   * "Governmental". Indented so the hierarchy is visible; selecting the
   * parent already matches every subgroup (see migration 0008), so these
   * are for narrowing to one part of a practice.
   */
  isSubOption?: boolean;
}

interface MultiSelectFilterProps {
  label: string;
  /** Shown on the summary when nothing is selected, e.g. "All Practice Areas". */
  emptyLabel: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /**
   * Placeholder for a box that narrows the list as you type, e.g. "Find a
   * subject". Omit it for a list short enough to read at a glance; 26
   * subjects is not, and scrolling a checkbox list hunting for one word is
   * the thing this control exists to avoid.
   */
  findPlaceholder?: string;
}

/**
 * Case-insensitive substring match on what the reader sees, and on the
 * stored value so a subgroup can be found by its parent's name. Exported to
 * be tested without rendering -- vitest here runs in node and collects
 * *.test.ts only.
 */
export function filterOptions(
  options: FilterOption[],
  term: string,
  selected: readonly string[] = [],
): FilterOption[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      option.value.toLowerCase().includes(needle) ||
      // A selected option always stays visible. Filtered out, its checkbox
      // disappears and there is no way to untick it from inside the control
      // -- only "Clear", which drops everything. Worse, the panel could read
      // "Nothing matches" while two filters were actively narrowing the
      // results, with nothing on screen saying so.
      selected.includes(option.value),
  );
}

const SUMMARY_CLASS =
  "flex cursor-pointer select-none items-center gap-1.5 rounded border border-control-border bg-surface px-3 py-2 text-sm marker:content-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function MultiSelectFilter({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  findPlaceholder,
}: MultiSelectFilterProps) {
  const [findTerm, setFindTerm] = useState("");
  const visibleOptions = findPlaceholder ? filterOptions(options, findTerm, selected) : options;

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  // Names the selection rather than just counting it when there is only one,
  // so the common case reads as a filter rather than as a number.
  const summaryText =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  return (
    <details className="group relative">
      <summary className={SUMMARY_CLASS} aria-label={`${label}: ${summaryText}`}>
        {summaryText}
        {/* The native disclosure triangle is removed by marker:content-none,
            which left no sign the control opened at all. Decorative, so
            hidden from assistive tech -- the summary element already carries
            its own expanded/collapsed state. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="size-3 shrink-0 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      {/* Never wider than the screen it opens on: at 390px a fixed 18rem
            panel opening near the right edge pushed the whole page sideways. */}
      <div className="absolute z-10 mt-1 max-h-80 w-[min(18rem,calc(100vw-2.5rem))] overflow-y-auto rounded border border-border bg-surface p-2 shadow-lg">
        {findPlaceholder && (
          <input
            type="search"
            value={findTerm}
            onChange={(e) => setFindTerm(e.target.value)}
            placeholder={findPlaceholder}
            aria-label={findPlaceholder}
            className="mb-2 w-full rounded border border-control-border bg-surface px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        )}

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-link hover:underline"
          >
            Clear {label.toLowerCase()}
          </button>
        )}

        {visibleOptions.length === 0 && (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            Nothing matches &ldquo;{findTerm.trim()}&rdquo;
          </p>
        )}

        {visibleOptions.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-border/40 ${
              option.isSubOption ? "pl-6" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
              className="mt-0.5"
            />
            <span className={option.isSubOption ? "text-muted-foreground" : ""}>{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
