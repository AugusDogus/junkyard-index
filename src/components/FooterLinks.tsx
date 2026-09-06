import Link from "next/link";
import { TrackedRequestYardLink } from "~/components/TrackedRequestYardLink";

const FOOTER_LINKS = [
  { kind: "static", href: "/home", label: "Home" },
  { kind: "static", href: "/search", label: "Search" },
  { kind: "static", href: "/pricing", label: "Pricing" },
  { kind: "request-yard" },
  { kind: "static", href: "/privacy", label: "Privacy Policy" },
  { kind: "static", href: "/terms", label: "Terms of Service" },
  { kind: "static", href: "/contact", label: "Contact" },
  {
    kind: "static",
    href: "https://github.com/AugusDogus/junkyard-index",
    label: "GitHub",
  },
] as const;

export function FooterLinks() {
  return (
    <nav
      aria-label="Footer"
      className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-sm"
    >
      {FOOTER_LINKS.map((link) =>
        link.kind === "request-yard" ? (
          <TrackedRequestYardLink key="request-yard" />
        ) : (
          <Link
            key={link.href}
            href={link.href}
            className="hover:text-foreground transition-colors"
          >
            {link.label}
          </Link>
        ),
      )}
    </nav>
  );
}
