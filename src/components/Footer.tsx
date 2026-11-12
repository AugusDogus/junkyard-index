import { Suspense } from "react";
import { FooterLinks, footerLinkClassName } from "~/components/FooterLinks";
import { StatusChip } from "~/components/StatusChip";
import { env } from "~/env";

/**
 * `live` fetches the status page's current state, cached for five minutes.
 * Pages served from the CDN use `link`, because that fetch would cap how long
 * the CDN may keep them.
 */
type FooterStatus = "live" | "link";

/** A mast: the wordmark set large over the grouped links and the status. */
export function Footer({ status = "live" }: { status?: FooterStatus }) {
  const statusPageUrl = env.NEXT_PUBLIC_STATUS_PAGE_URL;

  return (
    <footer className="border-ink bg-paper border-t-2">
      <div className="shell pt-14 pb-12 sm:pt-16">
        <p className="text-ink text-section tracking-display leading-none font-extrabold">
          Junkyard Index
        </p>
        <div className="border-ink mt-8 grid gap-10 border-t-2 pt-8 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-9">
            <FooterLinks />
          </div>
          {statusPageUrl && (
            <div className="lg:col-span-3 lg:justify-self-end">
              {status === "live" ? (
                <Suspense fallback={null}>
                  <StatusChip statusPageUrl={statusPageUrl} />
                </Suspense>
              ) : (
                <a
                  href={statusPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={footerLinkClassName}
                >
                  System status
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
