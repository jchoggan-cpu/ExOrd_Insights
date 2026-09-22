/**
 * The full-text search box.
 *
 * Its own file since the filter controls moved into a column beside the
 * results: search stays at the top of the results column, where what it
 * searches is obvious, rather than travelling into the sidebar with them.
 *
 * Rendered inside tracker-controls.tsx's client boundary, which owns the
 * debounced text and the navigation.
 */
export function TrackerSearchField({
  searchText,
  onSearchTextChange,
}: {
  searchText: string;
  onSearchTextChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor="tracker-search" className="sr-only">
        Search the full text of every order
      </label>
      <input
        id="tracker-search"
        type="search"
        value={searchText}
        onChange={(e) => onSearchTextChange(e.target.value)}
        placeholder="Search the full text of every order"
        className="w-full max-w-xl rounded border border-control-border bg-surface px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <span className="text-xs text-muted-foreground">
        Quotes for a phrase &middot; OR for either word
      </span>
    </div>
  );
}
