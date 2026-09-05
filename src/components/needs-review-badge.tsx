export function NeedsReviewBadge({ reason }: { reason?: string }) {
  return (
    <span
      title={reason}
      className="inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger"
    >
      ⚠ Needs review
    </span>
  );
}
