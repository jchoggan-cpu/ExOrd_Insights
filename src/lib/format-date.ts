const DATE_DISPLAY_OPTIONS = {
  short: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateDisplayStyle = keyof typeof DATE_DISPLAY_OPTIONS;

/**
 * Formats a date-only ISO string (e.g. "2025-09-29", as stored in
 * date_signed/date_published and the legacy import JSON) for display.
 *
 * WHY timeZone: "UTC": per the ECMAScript spec, `new Date("2025-09-29")`
 * always parses a date-only string as UTC midnight, never local midnight.
 * If toLocaleDateString then formats that instant in the runtime's local
 * timezone (its default), the result shifts back a calendar day in every
 * timezone behind UTC — all of the US included. Passing timeZone: "UTC"
 * makes formatting read the same UTC-midnight components the parser wrote,
 * so the displayed day always matches the stored value no matter where or
 * when this code runs.
 */
export function formatDate(iso: string | undefined, style: DateDisplayStyle = "short"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { ...DATE_DISPLAY_OPTIONS[style], timeZone: "UTC" });
}
