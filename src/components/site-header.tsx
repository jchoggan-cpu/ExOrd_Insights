import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "Tracker" },
  { href: "/needs-attention", label: "Needs Attention" },
  { href: "/prompt", label: "Summary Prompt" },
  { href: "/usage", label: "API Spend" },
];

/** The primary action, pinned out of the row of links as a filled button. */
const PRIMARY_ACTION = { href: "/draft", label: "Create Alert/Content" };

/**
 * The bar across the top of every page.
 *
 * The wordmark carries no firm name on purpose: the tool is not yet approved
 * for use under it, so the product names itself. See the note in globals.css
 * about swapping in real brand assets.
 *
 * Below `sm` the wordmark and the links stack, and the links scroll
 * sideways within their own row rather than widening the page -- five links
 * plus a button measured 621px against a 390px screen. Scrolling is safe
 * here in a way it is not for the filters, because these are plain links
 * with no popover to clip.
 *
 * The primary action stays out of that scrolling row on a phone and sits
 * beside the wordmark instead: inside the row it was the one thing pushed
 * off the right edge, which is the opposite of pinning it.
 */
export function SiteHeader() {
  return (
    <header className="bg-header text-header-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-4">
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <Link href="/" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="font-display text-lg font-semibold tracking-tight sm:text-xl">
              Executive Order
            </span>
            <span className="text-sm text-header-foreground/70">Tracker</span>
          </Link>

          <Link
            href={PRIMARY_ACTION.href}
            className="shrink-0 rounded bg-header-foreground px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-header transition-opacity hover:opacity-90 sm:hidden"
          >
            Create
          </Link>
        </div>

        <div className="-mx-6 flex items-center gap-4 overflow-x-auto px-6 sm:mx-0 sm:justify-end sm:px-0">
          <nav className="flex items-center gap-4 text-sm font-medium whitespace-nowrap sm:gap-5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-header-foreground/80 transition-colors hover:text-header-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href={PRIMARY_ACTION.href}
            className="hidden shrink-0 rounded bg-header-foreground px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-header transition-opacity hover:opacity-90 sm:inline-block"
          >
            {PRIMARY_ACTION.label}
          </Link>
        </div>
      </div>
    </header>
  );
}
