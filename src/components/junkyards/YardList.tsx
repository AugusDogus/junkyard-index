import Link from "next/link";
import { YardName } from "~/lib/yard-name";
import type { RoutedYard } from "~/server/yard-inventory";

const count = (value: number) => value.toLocaleString("en-US");

/** Links to yards' inventory pages with their city and live count. */
export function YardList({ yards }: { yards: readonly RoutedYard[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {yards.map((yard) => (
        <li key={yard.path.href}>
          <Link
            href={yard.path.href}
            prefetch={false}
            className="hover:bg-muted flex h-full flex-col rounded-lg border p-3"
          >
            <span className="text-sm font-medium text-pretty">
              {YardName.headline(yard.name, yard.operator)}
            </span>
            <span className="text-muted-foreground mt-1 text-xs tabular-nums">
              {yard.city}, {yard.state} · {count(yard.vehicleCount)}{" "}
              {yard.vehicleCount === 1 ? "vehicle" : "vehicles"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
