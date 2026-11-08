import Link from "next/link";
import { TrackedRequestYardLink } from "~/components/TrackedRequestYardLink";

type FooterLink =
  | { kind: "static"; href: string; label: string }
  | { kind: "request-yard" };

/** The footer's links, grouped the way a station sign groups its exits. */
const FOOTER_GROUPS: readonly {
  id: string;
  label: string;
  links: readonly FooterLink[];
}[] = [
  {
    id: "footer-browse",
    label: "Browse",
    links: [
      { kind: "static", href: "/home", label: "Home" },
      { kind: "static", href: "/search", label: "Search" },
      { kind: "static", href: "/junkyards", label: "Junkyards" },
      { kind: "static", href: "/cars", label: "Cars by make" },
    ],
  },
  {
    id: "footer-service",
    label: "Service",
    links: [
      { kind: "static", href: "/pricing", label: "Pricing" },
      { kind: "request-yard" },
      { kind: "static", href: "/contact", label: "Contact" },
      {
        kind: "static",
        href: "https://github.com/AugusDogus/junkyard-index",
        label: "GitHub",
      },
    ],
  },
  {
    id: "footer-legal",
    label: "Legal",
    links: [
      { kind: "static", href: "/privacy", label: "Privacy Policy" },
      { kind: "static", href: "/terms", label: "Terms of Service" },
    ],
  },
];

export const footerLinkClassName =
  "board-step inline-flex min-h-11 items-center whitespace-nowrap text-ink underline decoration-transparent decoration-2 underline-offset-[0.3em] hover:text-signal hover:decoration-current focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focus sm:min-h-9";

export function FooterLinks() {
  return (
    <nav
      aria-label="Footer"
      className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3"
    >
      {FOOTER_GROUPS.map((group) => (
        <div key={group.id}>
          <p id={group.id} className="text-ink-3 mb-3 text-sm font-medium">
            {group.label}
          </p>
          <ul aria-labelledby={group.id} className="text-[0.9375rem]">
            {group.links.map((link) => (
              <li key={link.kind === "static" ? link.href : link.kind}>
                {link.kind === "request-yard" ? (
                  <TrackedRequestYardLink className={footerLinkClassName} />
                ) : (
                  <Link href={link.href} className={footerLinkClassName}>
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
