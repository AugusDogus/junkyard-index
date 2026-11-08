import { ArrowUpRight, Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { HomepageYard } from "~/lib/homepage-inventory";
import { yardPhoneHref } from "~/lib/yard-phone";

const linkClassName =
  "board-step pointer-events-auto hover:text-signal focus-visible:outline-focus inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap underline decoration-1 underline-offset-[0.3em] hover:decoration-2 outline-none focus-visible:outline-2 focus-visible:outline-solid";

export function YardLinks({ yard }: { yard: HomepageYard }) {
  const phoneHref = yardPhoneHref(yard.phone);
  return (
    <div className="text-ink-2 pointer-events-none relative z-10 flex items-center gap-3.5 text-[0.8125rem]">
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
        {phoneHref && (
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent>{yard.phone}</TooltipContent>
          </Tooltip>
        )}
        {yard.email && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="pointer-events-auto size-9"
              >
                <a
                  href={`mailto:${encodeURIComponent(yard.email)}`}
                  aria-label={`Email ${yard.name}`}
                >
                  <Mail aria-hidden="true" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{yard.email}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
