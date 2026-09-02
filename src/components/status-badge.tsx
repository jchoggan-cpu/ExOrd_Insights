import type { EoStatus } from "@/lib/types";

const STYLES: Record<EoStatus, string> = {
  active: "bg-success/10 text-success border-success/30",
  amended: "bg-accent/10 text-accent-strong border-accent/30",
  revoked: "bg-danger/10 text-danger border-danger/30",
};

const LABELS: Record<EoStatus, string> = {
  active: "Active",
  amended: "Amended",
  revoked: "Revoked",
};

export function StatusBadge({ status }: { status: EoStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
