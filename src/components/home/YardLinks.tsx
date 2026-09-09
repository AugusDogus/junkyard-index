import { ArrowUpRight, MapPin } from "lucide-react";
import type { HomepageYard } from "~/lib/homepage-inventory";

export function YardLinks({ yard }: { yard: HomepageYard }) {
  return (
    <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {yard.websiteUrl && (
        <a
          href={yard.websiteUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Website for ${yard.name} (opens in a new tab)`}
          className="hover:text-foreground inline-flex min-h-8 items-center gap-1 underline underline-offset-4"
        >
          Website <ArrowUpRight className="size-3" aria-hidden="true" />
        </a>
      )}
      <a
        href={yard.mapsUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Find ${yard.name} in ${yard.city}, ${yard.state} on Google Maps (opens in a new tab)`}
        className="hover:text-foreground inline-flex min-h-8 items-center gap-1 underline underline-offset-4"
      >
        <MapPin className="size-3" aria-hidden="true" /> Google Maps
      </a>
    </div>
  );
}
