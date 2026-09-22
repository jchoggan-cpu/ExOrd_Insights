"use client";

import { isSelected } from "@/lib/eo-selection";
import { useEoSelection } from "@/components/use-eo-selection";

/**
 * The tick box on one results row.
 *
 * A small client component inside a server-rendered row, so ticking a row
 * does not turn the whole list back into JavaScript shipped to the browser.
 */
export function EoSelectCheckbox({ id, title }: { id: string; title: string }) {
  const { selected, toggle } = useEoSelection();

  // The visible box stays 16px, but the padded label around it gives a
  // 32px tap target -- on a phone this is the only way to pick a row for
  // drafting, and a bare 16px input is well under the 24px minimum.
  return (
    <label className="-m-2 flex shrink-0 cursor-pointer items-start self-start p-2">
      <input
        type="checkbox"
        checked={isSelected(selected, id)}
        onChange={() => toggle(id)}
        aria-label={`Select "${title}" for drafting`}
        className="size-4 cursor-pointer accent-link focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
    </label>
  );
}
