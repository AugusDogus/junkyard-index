import type { DataSource, SearchVehicle } from "./types";

export type VehicleDestination =
  | { kind: "inventory"; href: string; label: string }
  | {
      kind: "manual-search";
      href: string;
      label: "Search provider inventory";
      explanation: string;
    }
  | { kind: "unavailable"; explanation: string };

// Verified public entry points, not vehicle permalinks. See docs/runbooks/*-media-links.md.
const manualSearchUrls: Partial<Record<DataSource, string>> = {
  pullnsave: "https://www.pullnsave.com/inventory/",
  tearapart: "https://tearapart.com/inventory/",
  upullrparts: "https://upullrparts.com/inventory/",
  partsgalore: "https://parts-galore.com/inventory/",
};

function resolve(
  vehicle: Pick<SearchVehicle, "source" | "detailsUrl">,
): VehicleDestination {
  const manualSearchUrl = manualSearchUrls[vehicle.source];
  // Also correct old generic/unsupported links in the index and queued alerts.
  if (manualSearchUrl) {
    return {
      kind: "manual-search",
      href: manualSearchUrl,
      label: "Search provider inventory",
      explanation:
        "This provider has no vehicle links. Select make/model on its inventory page, then match the VIN and yard.",
    };
  }

  const href = vehicle.detailsUrl?.trim();
  if (!href || !URL.canParse(href) || !/^https?:\/\//i.test(href)) {
    return {
      kind: "unavailable",
      explanation:
        "Provider link unavailable. Use the VIN and yard to identify this vehicle.",
    };
  }

  return {
    kind: "inventory",
    href,
    label:
      vehicle.source === "wrenchapart"
        ? "View vehicle"
        : vehicle.source === "ipullupull" || vehicle.source === "upullitwa"
          ? "View matching inventory"
          : "View inventory",
  };
}

export const VehicleDestination = { resolve } as const;
