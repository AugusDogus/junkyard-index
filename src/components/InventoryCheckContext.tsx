"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  InventoryStaleness,
  type InventoryCheckDates,
} from "~/lib/inventory-staleness";

/** Stale sources' and yards' check dates, and the render's clock. */
export type InventoryCheck = { dates: InventoryCheckDates; now: number };

const InventoryCheckContext = createContext<InventoryCheck | null>(null);

/**
 * Gives search hits their "Last checked N days ago" labels. The search page
 * reads the dates on the server (`getInventoryCheckDates`, narrowed with
 * `InventoryStaleness.staleOnly`) and renders with its own clock, so the
 * hydrated labels match the server's. Only the search page lists hits; a
 * card outside a provider has no label.
 */
export function InventoryCheckProvider({
  check,
  children,
}: {
  check: InventoryCheck;
  children: ReactNode;
}) {
  return (
    <InventoryCheckContext.Provider value={check}>
      {children}
    </InventoryCheckContext.Provider>
  );
}

/** "Last checked N days ago" for a vehicle at this yard, or null if current. */
export function useInventoryCheckLabel(
  source: string,
  locationCode: string,
): string | null {
  const check = useContext(InventoryCheckContext);
  if (check === null) return null;
  return InventoryStaleness.label(
    InventoryStaleness.checkedAt(check.dates, source, locationCode),
    check.now,
  );
}
