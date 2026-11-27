import Link from "next/link";
import { TrackedRequestYardLink } from "~/components/TrackedRequestYardLink";

/**
 * Where else a footer link is reachable. Paid users scroll /search without
 * end, so its footer never comes into view: every link must also be in the
 * header (its brand or main links) or in the signed-in account menu, which
 * lists the "account-menu" ones.
 */
type FooterLinkReach = "header" | "account-menu";

type FooterLink =
  | {
      kind: "static";
      href: string;
      label: string;
      alsoIn: FooterLinkReach;
      /** Off for pages that render on every request, such as search. */
      prefetch?: false;
    }
  | { kind: "request-yard"; alsoIn: FooterLinkReach };

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
      { kind: "static", href: "/", label: "Home", alsoIn: "header" },
      { kind: "static", href: "/map", label: "Yard map", alsoIn: "header" },
      {
        kind: "static",
        href: "/search",
        label: "Search",
        alsoIn: "header",
        prefetch: false,
      },
      {
        kind: "static",
        href: "/junkyards",
        label: "Junkyards",
        alsoIn: "header",
      },
      {
        kind: "static",
        href: "/chains",
        label: "Chains",
        // The phone header row has no room for another link.
        alsoIn: "account-menu",
      },
      {
        kind: "static",
        href: "/cars",
        label: "Cars by make",
        alsoIn: "header",
      },
    ],
  },
  {
    id: "footer-service",
    label: "Service",
    links: [
      { kind: "static", href: "/pricing", label: "Pricing", alsoIn: "header" },
      { kind: "request-yard", alsoIn: "account-menu" },
      {
        kind: "static",
        href: "/contact",
        label: "Contact",
        alsoIn: "account-menu",
      },
      {
        kind: "static",
        href: "https://github.com/AugusDogus/junkyard-index",
        label: "GitHub",
        alsoIn: "account-menu",
      },
    ],
  },
  {
    id: "footer-legal",
    label: "Legal",
    links: [
      {
        kind: "static",
        href: "/privacy",
        label: "Privacy Policy",
        alsoIn: "account-menu",
      },
      {
        kind: "static",
        href: "/terms",
        label: "Terms of Service",
        alsoIn: "account-menu",
      },
    ],
  },
];

/** The footer links the header lacks, for the account menu. */
export const ACCOUNT_MENU_FOOTER_LINKS: readonly FooterLink[] =
  FOOTER_GROUPS.flatMap((group) =>
    group.links.filter((link) => link.alsoIn === "account-menu"),
  );

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
                  <Link
                    href={link.href}
                    prefetch={link.prefetch}
                    className={footerLinkClassName}
                  >
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
