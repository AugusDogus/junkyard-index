import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Crumb } from "~/lib/structured-data";

/** Visible trail; the last crumb is the current page. */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 sm:mb-8">
      <ol className="text-ink-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && (
                <ChevronRight
                  className="text-ink-3 size-3.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              {current ? (
                <span aria-current="page" className="text-ink font-medium">
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="board-step hover:text-signal focus-visible:outline-focus active:text-ink whitespace-nowrap underline decoration-1 underline-offset-[0.3em] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
