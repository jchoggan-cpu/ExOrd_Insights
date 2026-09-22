type TagKind = "subject" | "practice" | "industry";

const KIND_STYLES: Record<TagKind, string> = {
  subject: "bg-border/60 text-foreground",
  practice: "bg-link/10 text-link",
  industry: "bg-brand/15 text-primary",
};

export function TagPill({ label, kind = "subject" }: { label: string; kind?: TagKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${KIND_STYLES[kind]}`}
    >
      {label}
    </span>
  );
}
