"use client";

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
}

const SUMMARY_CLASS =
  "cursor-pointer select-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none marker:content-none focus:border-link";

export function MultiSelectFilter({ label, emptyLabel, options, selected, onChange }: MultiSelectFilterProps) {
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
    <details className="relative">
      <summary className={SUMMARY_CLASS} aria-label={label}>
        {summaryText}
      </summary>

      <div className="absolute z-10 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-lg">
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-link hover:underline"
          >
            Clear {label.toLowerCase()}
          </button>
        )}

        {options.map((option) => (
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
            <span className={option.isSubOption ? "text-muted" : ""}>{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
