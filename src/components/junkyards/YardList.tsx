import { YardRows } from "~/components/inventory/YardRows";
import { InventoryFormat } from "~/lib/inventory-format";
import { YardName } from "~/lib/yard-name";
import type { RoutedYard } from "~/server/yard-inventory";

/** Links to yards' inventory pages, as compact rows with their live count. */
export function YardList({ yards }: { yards: readonly RoutedYard[] }) {
  return (
    <YardRows
      rows={yards.map((yard) => ({
        href: yard.path.href,
        name: YardName.headline(yard.name, yard.operator),
        place: `${yard.city}, ${yard.state}`,
        figure: InventoryFormat.count(yard.vehicleCount),
        detail: yard.vehicleCount === 1 ? "vehicle" : "vehicles",
      }))}
    />
  );
}
