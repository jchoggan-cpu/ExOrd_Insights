export function LocalDataBanner() {
  return (
    <div className="mx-auto w-full max-w-[120rem] px-4 pt-4">
      <div className="rounded-md border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-primary">
        Showing data imported from the firm&apos;s original tracker spreadsheet (maintained
        through Jan 20, 2026). Connect Supabase to move to a live, auto-updating database —
        see the README.
      </div>
    </div>
  );
}
