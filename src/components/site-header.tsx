import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "Tracker" },
  { href: "/draft", label: "Create Alert/Content" },
  { href: "/needs-attention", label: "Needs Attention" },
  { href: "/prompt", label: "Summary Prompt" },
  { href: "/usage", label: "API Spend" },
];

/**
 * The bar across the top of every page.
 *
 * The wordmark carries no firm name on purpose: the tool is not yet approved
 * for use under it, so the product names itself. See the note in
 * globals.css about swapping in real brand assets.
 */
export function SiteHeader() {
  return (
    <header className="bg-header text-header-foreground">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight">
            Executive Order
          </span>
          <span className="text-sm text-header-foreground/70">Tracker</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium">
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
      </div>
    </header>
  );
}
