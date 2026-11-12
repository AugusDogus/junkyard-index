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

// Verified public entry points, not vehicle permalinks. See docs/runbooks/provider-media-links.md.
const manualSearchUrls: Partial<Record<DataSource, string>> = {
  chasencars: "https://chasencarsauto.com/inventory/",
  indianriver: "https://indianriverautosalvage.com/inventory-3/",
  upullitne: "https://upullitne.com/search-inventory/",
  pullnsave: "https://www.pullnsave.com/inventory/",
  tearapart: "https://tearapart.com/inventory/",
  upullrparts: "https://upullrparts.com/inventory/",
  partsgalore: "https://parts-galore.com/inventory/",
  nvpap: "https://nvpap.com/part-interchange.html",
  aero: "https://aeroautosalvage.com/vehicle-inventory/",
  meeks: "https://meeksrecycling.com/pic-and-pull/",
  chesterfield: "https://chesterfieldauto.com/search-our-inventory-by-location",
  midway: "https://midwayupull.com/inventory/",
  ddauto: "https://dd-auto-parts-cars.glide.page/dl/17171d",
  army: "https://armysauto.com/self-service-inventory/",
  idipull: "https://ifipull.com/inventory/",
  littleton: "https://littletonupullit.com/vehicle-inventory",
  joliet: "https://www.jolietupullit.com/inventory",
  pickers: "https://pickerstxk.com/Home/Inventory",
  pipes: "https://www.pipesupullit.net/Home/Inventory",
  uwrench: "https://uwrenchandsave.com/inventory/",
  millerstown: "http://picapartyard.com/vehicles-on-premises/",
  pickapartva: "https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY",
};

function manualSearchExplanation(source: DataSource): string {
  switch (source) {
    case "chasencars":
      return "Search the yard inventory by VIN or stock number, then match the year, make, model and yard row.";
    case "indianriver":
      return "Search the inventory by VIN or serial number and match the year, make and model. This provider's Row column contains vehicle identities.";
    case "chesterfield":
      return "Select make, model and years, find the matching yard, then open Pics and match the stock number.";
    case "pickers":
    case "pipes":
      return "Select the vehicle's make, then match its stock number and yard row in the inventory table.";
    case "uwrench":
      return "Match the vehicle's year, make, model, stock number and yard row in the inventory table.";
    case "millerstown":
      return "Open the current vehicles-on-premises PDF, then match the VIN or serial number, year, make, model and stock number.";
    case "pickapartva":
      return "Search the inventory by VIN or stock number, then confirm the matching yard.";
    case "aero":
    case "meeks":
    case "ddauto":
    case "army":
    case "idipull":
    case "littleton":
    case "joliet":
      return "This provider has no vehicle links. Search its inventory table, then match the VIN and stock number.";
    default:
      return "This provider has no vehicle links. Select make/model on its inventory page, then match the VIN and yard.";
  }
}

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
      explanation: manualSearchExplanation(vehicle.source),
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
        : vehicle.source === "ipullupull" ||
            vehicle.source === "upullitwa" ||
            vehicle.source === "utpap"
          ? "View matching inventory"
          : "View inventory",
  };
}

export const VehicleDestination = { resolve } as const;
