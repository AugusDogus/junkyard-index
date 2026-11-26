import Link from "next/link";
import { InventoryFormat } from "~/lib/inventory-format";
import type { Region } from "~/lib/region";
import { YardPath } from "~/lib/yard-path";

const inlineLinkClassName =
  "text-ink hover:text-signal underline decoration-1 underline-offset-[0.3em] hover:decoration-2 focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-solid";

/**
 * Every state hub as a plain link. The yard directory above is virtualized,
 * so its server HTML holds only a few yards; this list is how crawlers get
 * from the homepage to every state and, from there, every yard.
 */
export function HomeStateIndex({
  regions,
}: {
  regions: readonly { region: Region; yards: number }[];
}) {
  return (
    <section aria-labelledby="home-states-title" className="shell py-12">
      <div className="grid gap-y-3 lg:grid-cols-12 lg:items-baseline lg:gap-x-8">
        <h2
          id="home-states-title"
          className="text-section leading-[1.02] font-extrabold lg:col-span-5"
        >
          Junkyards by state
        </h2>
        <p className="text-lead text-ink-2 leading-[1.45] lg:col-span-7">
          Every yard we track, with its full inventory. See{" "}
          <Link href="/junkyards" className={inlineLinkClassName}>
            all junkyards
          </Link>{" "}
          or{" "}
          <Link href="/chains" className={inlineLinkClassName}>
            yards by chain
          </Link>
          .
        </p>
      </div>
      <ul className="border-ink mt-(--space-xl) gap-x-10 border-t-2 sm:columns-2 lg:columns-4">
        {regions.map(({ region, yards }) => (
          <li
            key={region.slug}
            className="border-rule break-inside-avoid border-b"
          >
            <Link
              href={YardPath.regionHref(region)}
              prefetch={false}
              className="group board-step hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus flex items-baseline justify-between gap-4 px-2 py-2.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
            >
              <span className="board-step group-hover:text-signal text-[0.9375rem] leading-snug font-extrabold">
                {region.name}
              </span>
              <span className="text-ink-2 text-sm whitespace-nowrap tabular-nums">
                {InventoryFormat.count(yards)}
                {yards === 1 ? " yard" : " yards"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
