import { ArrowUpRight, Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import type { HomepageYard } from "~/lib/homepage-inventory";
import { yardPhoneHref } from "~/lib/yard-phone";

const linkClassName =
  "board-step pointer-events-auto hover:text-signal focus-visible:outline-focus inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap underline decoration-1 underline-offset-[0.3em] hover:decoration-2 outline-none focus-visible:outline-2 focus-visible:outline-solid";

export function YardLinks({ yard }: { yard: HomepageYard }) {
  const phoneHref = yardPhoneHref(yard.phone);
  return (
    <div className="text-ink-2 pointer-events-none relative z-10 flex flex-wrap items-center gap-x-3.5 text-[0.8125rem]">
      {yard.path && (
        <Link
          href={yard.path.href}
          prefetch={false}
          aria-label={`Inventory at ${yard.name}`}
          className={`${linkClassName} text-ink font-extrabold`}
        >
          Inventory
        </Link>
      )}
      {yard.website && (
        <a
          href={yard.website.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${yard.website.kind === "provider" ? "Provider website" : "Website"} for ${yard.name} (opens in a new tab)`}
          className={linkClassName}
        >
          {yard.website.kind === "provider" ? "Provider" : "Website"}
          <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
        </a>
      )}
      <a
        href={yard.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Find ${yard.name} in ${yard.city}, ${yard.state} on Google Maps (opens in a new tab)`}
        className={linkClassName}
      >
        <MapPin className="size-3 shrink-0" aria-hidden="true" /> Maps
      </a>
      <div className="ml-auto flex items-center gap-1">
        {phoneHref && yard.phone && (
          <ContactTip tip={yard.phone}>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="pointer-events-auto size-9"
            >
              <a
                href={phoneHref}
                aria-label={`Call ${yard.name}: ${yard.phone}`}
              >
                <Phone aria-hidden="true" />
              </a>
            </Button>
          </ContactTip>
        )}
        {yard.email && (
          <ContactTip tip={yard.email}>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="pointer-events-auto size-9"
            >
              <a
                href={`mailto:${encodeURIComponent(yard.email)}`}
                aria-label={`Email ${yard.name}: ${yard.email}`}
              >
                <Mail aria-hidden="true" />
              </a>
            </Button>
          </ContactTip>
        )}
      </div>
    </div>
  );
}

/**
 * The phone number or email for its icon. On hover the browser shows its own
 * title tip; on keyboard focus this one shows at once, and Escape hides it
 * until focus leaves (WCAG 1.4.13). CSS and two handlers rather than a script
 * tooltip, because the directory renders every yard's links and a tooltip
 * component on each one cost hydration on every page view. It sits to the
 * left of the icon so the directory's scroll box never clips it.
 */
function ContactTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <span
      className="group/tip relative"
      title={tip}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.dataset.dismissed = "";
        }
      }}
      onBlur={(event) => {
        delete event.currentTarget.dataset.dismissed;
      }}
    >
      {children}
      <span
        aria-hidden="true"
        className="bg-ink text-paper pointer-events-none invisible absolute top-1/2 right-full z-20 mr-1 -translate-y-1/2 px-2 py-1 text-xs font-medium whitespace-nowrap group-focus-within/tip:visible group-data-dismissed/tip:invisible!"
      >
        {tip}
      </span>
    </span>
  );
}
