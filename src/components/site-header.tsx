import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "Tracker" },
  { href: "/draft", label: "Draft Content" },
  { href: "/needs-attention", label: "Needs Attention" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">
            Sheppard
          </span>
          <span className="text-sm text-muted">EO Tracker</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-foreground/80 transition-colors hover:text-link"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
