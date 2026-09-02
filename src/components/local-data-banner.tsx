export function LocalDataBanner() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 pt-4">
      <div className="rounded-md border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent-strong">
        Showing data imported from the firm&apos;s original tracker spreadsheet (maintained
        through Jan 20, 2026). Connect Supabase to move to a live, auto-updating database —
        see the README.
      </div>
    </div>
  );
}
