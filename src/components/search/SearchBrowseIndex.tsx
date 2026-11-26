import Link from "next/link";
import type { Region } from "~/lib/region";
import { YardPath } from "~/lib/yard-path";

const linkClassName =
  "text-ink hover:text-signal underline decoration-1 underline-offset-[0.3em] hover:decoration-2 focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-solid";

export type SearchBrowse = {
  /** States and provinces with yards, by name. */
  regions: readonly Region[];
  /** The makes with the most live vehicles, most first. */
  makes: readonly { name: string; href: string }[];
};

/**
 * /search's visible page text: links into the state and make pages. It is
 * the same for every visitor, so crawlers, which never run the search
 * (src/lib/search-server-render.ts), read a page with content, and people
 * find it below their results.
 */
export function SearchBrowseIndex({ regions, makes }: SearchBrowse) {
  return (
    <section
      aria-labelledby="search-browse-title"
      className="shell border-rule mt-(--space-2xl) border-t py-12"
    >
      <h2
        id="search-browse-title"
        className="text-section leading-[1.02] font-medium"
      >
        Browse salvage yard inventory
      </h2>
      <p className="text-lead text-ink-2 mt-3 max-w-[56ch] leading-[1.45]">
        Every yard page lists the vehicles it has now. Start from a state or a
        make.
      </p>
      <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-x-10">
        <nav aria-labelledby="search-browse-states">
          <h3
            id="search-browse-states"
            className="text-ink-3 text-sm font-medium"
          >
            By state
          </h3>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[0.9375rem]">
            {regions.map((region) => (
              <li key={region.slug}>
                <Link
                  href={YardPath.regionHref(region)}
                  prefetch={false}
                  className={linkClassName}
                >
                  {region.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-labelledby="search-browse-makes">
          <h3
            id="search-browse-makes"
            className="text-ink-3 text-sm font-medium"
          >
            Popular makes
          </h3>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[0.9375rem]">
            {makes.map((make) => (
              <li key={make.href}>
                <Link
                  href={make.href}
                  prefetch={false}
                  className={linkClassName}
                >
                  {make.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
