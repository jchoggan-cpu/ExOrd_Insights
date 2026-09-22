import type { Metadata } from "next";
import { Lora, Poppins } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

/*
 * Two fonts, two CSS variables, both consumed by globals.css: --font-body
 * becomes Tailwind's `font-sans` and --font-display becomes `font-display`.
 *
 * shadcn's installer adds a third font here (Geist) bound directly to
 * --font-sans, which fights globals.css for the same variable. Removed on
 * purpose: if it is ever reintroduced, the body font silently changes.
 */

// Poppins is not a variable font, so next/font needs the weights spelled
// out. These four are what the UI uses: body, emphasis, labels, headings.
const bodyFont = Poppins({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const displayFont = Lora({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // No firm name anywhere in the UI until the tool is approved for use under
  // it. See the palette note in globals.css.
  title: "Executive Actions Tracker",
  description:
    "Internal tool for tracking executive orders, their legal impact, and drafting client-ready content about them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <SiteHeader />
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
