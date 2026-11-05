import { Suspense } from "react";
import { FooterLinks } from "~/components/FooterLinks";
import { StatusChip } from "~/components/StatusChip";
import { env } from "~/env";

/**
 * `live` fetches the status page's current state, cached for five minutes.
 * Pages served from the CDN use `link`, because that fetch would cap how long
 * the CDN may keep them.
 */
type FooterStatus = "live" | "link";

export function Footer({ status = "live" }: { status?: FooterStatus }) {
  const statusPageUrl = env.NEXT_PUBLIC_STATUS_PAGE_URL;

  return (
    <footer className="border-t px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <p className="text-sm font-semibold whitespace-nowrap">
          Junkyard Index
        </p>
        <FooterLinks />
        {statusPageUrl &&
          (status === "live" ? (
            <Suspense fallback={null}>
              <StatusChip statusPageUrl={statusPageUrl} />
            </Suspense>
          ) : (
            <a
              href={statusPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground text-xs whitespace-nowrap transition-colors sm:ml-auto"
            >
              System status
            </a>
          ))}
      </div>
    </footer>
  );
}
