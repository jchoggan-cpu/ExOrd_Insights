import { formatTagLabel } from "@/lib/tag-label";

type TagKind = "subject" | "practice" | "industry";

/**
 * Subject and practice carry equal visual weight -- same size, same shape,
 * different colour -- because subject is what the corpus is actually tagged
 * by (on 100% of rows) while practice area is the firm's own language and
 * the reason the tool exists. Neither earns demotion. Industry keeps the
 * style for the places it still appears as a pill; in the results list it is
 * a grey subtitle instead, since 44% of rows have none.
 *
 * The label wraps on a narrow screen and only holds one line once there is
 * room for it. Held to one line always, the longest label the live taxonomy
 * can produce -- "Litigation--Bankruptcy Litigation & Distressed Loan
 * Workouts", 61 characters -- measures 385px against a 358px row on a 390px
 * phone, and the results list clips it rather than scrolling, because of the
 * overflow-hidden that rounds its corners. The tag was silently cut off
 * mid-word with nothing to reveal it. Five rows in the first hundred already
 * sit within 14px of that edge.
 */
const KIND_STYLES: Record<TagKind, string> = {
  subject: "bg-foreground/[0.07] text-foreground",
  practice: "bg-link/10 text-link",
  industry: "bg-brand/15 text-primary",
};

export function TagPill({ label, kind = "subject" }: { label: string; kind?: TagKind }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-normal sm:whitespace-nowrap ${KIND_STYLES[kind]}`}
    >
      {formatTagLabel(label)}
    </span>
  );
}
