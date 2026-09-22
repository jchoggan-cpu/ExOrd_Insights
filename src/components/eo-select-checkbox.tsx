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

  return (
    <input
      type="checkbox"
      checked={isSelected(selected, id)}
      onChange={() => toggle(id)}
      aria-label={`Select "${title}" for drafting`}
      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-link"
    />
  );
}
