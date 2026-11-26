"use client";

import { YardPath } from "~/lib/yard-path";
import type { MapYard } from "./yard-map-data";

/**
 * The yards under one tap on stacked dots, nearest first. Picking one opens
 * its yard card. Only a pointer opens this list (Enter on a focused dot opens
 * that yard), so focus stays where it was.
 */
export function YardMapChoice({
  yards,
  onPick,
}: {
  yards: MapYard[];
  onPick: (yard: MapYard) => void;
}) {
  return (
    <>
      <p id="yard-map-choice-title" className="text-[0.9375rem] font-medium">
        {yards.length.toLocaleString("en-US")} yards here
      </p>
      <ul
        aria-labelledby="yard-map-choice-title"
        className="border-rule mt-2 max-h-56 overflow-y-auto overscroll-contain border-t"
      >
        {yards.map((yard) => (
          <li key={YardPath.key(yard)} className="border-rule border-b">
            <button
              type="button"
              className="hover:text-signal focus-visible:outline-focus block w-full py-2 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
              onClick={() => onPick(yard)}
            >
              <span className="block text-sm font-medium text-pretty">
                {yard.name}
              </span>
              <span className="text-ink-2 flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {yard.city}, {yard.state}
                </span>
                <span className="shrink-0 tabular-nums">
                  {yard.vehicleCount.toLocaleString("en-US")}{" "}
                  {yard.vehicleCount === 1 ? "vehicle" : "vehicles"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
