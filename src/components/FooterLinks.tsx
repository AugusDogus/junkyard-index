"use client";

import Link from "next/link";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";

const FOOTER_LINKS: {
  href: string;
  label: string;
  ctaLocation?: "footer";
}[] = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Search" },
  { href: "/pricing", label: "Pricing" },
  { href: "/request-yard", label: "Request a Yard", ctaLocation: "footer" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/contact", label: "Contact" },
];

export function FooterLinks() {
  return (
    <nav
      aria-label="Footer"
      className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-sm"
    >
      {FOOTER_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="hover:text-foreground transition-colors"
          onClick={() => {
            if (link.ctaLocation) {
              // source_page is the pathname (footer renders site-wide),
              // unlike page-scoped CTAs which send a literal page slug.
              trackRequestYardClick({
                location: link.ctaLocation,
                sourcePage: window.location.pathname,
              });
            }
          }}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
