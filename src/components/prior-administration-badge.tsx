import { ADMINISTRATION_START_DATE } from "@/lib/federal-register/constants";
import { formatDate } from "@/lib/format-date";

export function PriorAdministrationBadge({ dateSigned }: { dateSigned?: string }) {
  const title = dateSigned
    ? `Signed ${formatDate(dateSigned, "long")}, before this administration took office (${formatDate(ADMINISTRATION_START_DATE, "long")}). Included here because it was published in the Federal Register afterward.`
    : "Signed before this administration took office. Included here because it was published in the Federal Register afterward.";

  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-border/40 px-2.5 py-0.5 text-xs font-medium text-muted"
    >
      Prior administration
    </span>
  );
}
