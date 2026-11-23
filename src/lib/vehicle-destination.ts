import { HiddenSources } from "./hidden-source";
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
  alsauto: "https://www.alsautosalvagewi.com/latest-inventory",
  chasencars: "https://chasencarsauto.com/inventory/",
  sandw: "https://www.sandwauto.com/inventory-search",
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
  bigd: "https://bigdsalvage.com/inventory/",
  harrys: "https://wegotused.com/our-inventory/",
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
    case "alsauto":
      return "Search the parts inventory by VIN or lot number, then confirm availability with Al's Auto Salvage.";
    case "chasencars":
      return "Search the yard inventory by VIN or stock number, then match the year, make, model and yard row.";
    case "bigd":
      return "Search the inventory table by VIN, then match the year, make, model and yard row.";
    case "harrys":
      return "Select the vehicle make, model and yard, then match its VIN and yard row. Detail links use import row numbers that can change vehicles.";
    case "budget":
      return "Select the vehicle make, then match its VIN, stock number and yard row in the inventory table.";
    case "indianriver":
      return "Search the inventory by VIN or serial number and match the year, make and model. This provider's Row column contains vehicle identities.";
    case "sandw":
      return "Search the yard inventory by VIN or stock number, then confirm availability with S&W. The provider may serve cached inventory.";
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

/**
 * Where a vehicle's link goes on the site: nowhere for a hidden source,
 * which also covers alerts queued before the source was hidden; otherwise
 * its provider's link (`resolve`). Every page, email and message uses this.
 */
function forSite(
  vehicle: Pick<SearchVehicle, "source" | "detailsUrl">,
  hidden: HiddenSources,
): VehicleDestination {
  if (HiddenSources.has(hidden, vehicle.source)) {
    return {
      kind: "unavailable",
      explanation:
        "This yard's website is temporarily unavailable. Use the VIN and yard to identify this vehicle.",
    };
  }
  return resolve(vehicle);
}

/** The provider's link for a vehicle, whether or not its source is shown. */
function resolve(
  vehicle: Pick<SearchVehicle, "source" | "detailsUrl">,
): VehicleDestination {
  const yardUrl = vehicle.detailsUrl?.trim();
  if (
    vehicle.source === "vinplus" &&
    yardUrl ===
      "https://vinplus.texnrewards.com/parts/u-pull-auto-parts-pocatello"
  ) {
    return {
      kind: "unavailable",
      explanation:
        "Pocatello's public app hides vehicle search. Contact U Pull Auto Parts Pocatello with the VIN and stock number to confirm availability.",
    };
  }
  if (
    vehicle.source === "vinplus" &&
    yardUrl &&
    /^https:\/\/vinplus\.texnrewards\.com\/parts\/(ryans|us-auto-supply|yourpart|195-used-auto-parts|pick-ur-part|indy-u-pull-it)$/.test(
      yardUrl,
    )
  ) {
    return {
      kind: "manual-search",
      href: yardUrl,
      label: "Search provider inventory",
      explanation: "Match the VIN, stock number and physical yard.",
    };
  }
  const yardUrls =
    vehicle.source === "pickers"
      ? [
          "https://pickerstxk.com/Home/Inventory",
          "https://pickerslongview.com/Home/Inventory",
          "https://pickersreno.com/Home/Inventory",
        ]
      : vehicle.source === "midway"
        ? [
            "https://midwayupull.com/inventory/ANY/ANY/?k=1&id=MO38&view=table",
            "https://midwayupull.com/inventory/ANY/ANY/?k=1&id=MO09&view=table",
            "https://midwayupull.com/inventory/ANY/ANY/?k=1&id=OO95&view=table",
          ]
        : [];
  if (vehicle.source === "budget") {
    const url = yardUrl ? URL.parse(yardUrl) : null;
    const owned =
      url &&
      url.origin === "https://budgetupullit.com" &&
      url.pathname === "/current-inventory/" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.get("model") === "" &&
      url.searchParams.get("make") &&
      [...url.searchParams.keys()].length === 2;
    return {
      kind: "manual-search",
      href: owned ? url.href : "https://budgetupullit.com/current-inventory/",
      label: "Search provider inventory",
      explanation: manualSearchExplanation("budget"),
    };
  }
  const manualSearchUrl =
    yardUrl && yardUrls.includes(yardUrl)
      ? yardUrl
      : manualSearchUrls[vehicle.source];
  // Also correct old generic/unsupported links in the index and queued alerts.
  if (manualSearchUrl) {
    return {
      kind: "manual-search",
      href: manualSearchUrl,
      label: "Search provider inventory",
      explanation: manualSearchExplanation(vehicle.source),
    };
  }

  if (
    vehicle.source === "byot" &&
    vehicle.detailsUrl &&
    /^https:\/\/www\.byotautoparts\.com\/locations\/(waco|bryan-college-station|beaumont|baton-rouge|jackson-ms)\/inventory\/$/.test(
      vehicle.detailsUrl,
    )
  ) {
    return {
      kind: "manual-search",
      href: vehicle.detailsUrl,
      label: "Search provider inventory",
      explanation:
        "Select make and model, then match the VIN, stock number and yard row.",
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

export const VehicleDestination = { forSite, resolve } as const;
