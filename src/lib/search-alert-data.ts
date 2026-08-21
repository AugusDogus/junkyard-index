import type { SearchVehicle } from "~/lib/types";

const searchAlertMatchBrand: unique symbol = Symbol("SearchAlertMatch");
const searchAlertDigestBrand: unique symbol = Symbol("SearchAlertDigest");
export const MAX_SEARCH_ALERT_PREVIEW_VEHICLES = 10;
export const MAX_SEARCH_ALERT_DIGEST_PREVIEWS = 10;

export interface SearchAlertMatch {
  readonly count: number;
  readonly previewVehicles: readonly SearchVehicle[];
  readonly [searchAlertMatchBrand]: true;
}

export const SearchAlertMatch = {
  create(count: number, previewVehicles: SearchVehicle[]): SearchAlertMatch {
    if (
      !Number.isInteger(count) ||
      count <= 0 ||
      count < previewVehicles.length ||
      previewVehicles.length > MAX_SEARCH_ALERT_PREVIEW_VEHICLES
    ) {
      throw new Error(
        `Invalid search alert match: count=${count}, previewVehicles=${previewVehicles.length}`,
      );
    }
    return {
      count,
      previewVehicles: [...previewVehicles],
      [searchAlertMatchBrand]: true,
    };
  },
} as const;

export interface SearchAlertData {
  searchName: string;
  query: string;
  match: SearchAlertMatch;
  searchUrl: string;
  searchId: string;
}

export interface SearchAlertDigest {
  readonly previewAlerts: readonly SearchAlertData[];
  readonly alertCount: number;
  readonly vehicleCount: number;
  readonly [searchAlertDigestBrand]: true;
}

export const SearchAlertDigest = {
  create(
    previewAlerts: SearchAlertData[],
    alertCount: number,
    vehicleCount: number,
  ): SearchAlertDigest {
    const previewVehicleCount = previewAlerts.reduce(
      (total, alert) => total + alert.match.count,
      0,
    );
    if (
      !Number.isInteger(alertCount) ||
      !Number.isInteger(vehicleCount) ||
      previewAlerts.length === 0 ||
      previewAlerts.length > MAX_SEARCH_ALERT_DIGEST_PREVIEWS ||
      alertCount <= 0 ||
      vehicleCount <= 0 ||
      alertCount < previewAlerts.length ||
      vehicleCount < previewVehicleCount
    ) {
      throw new Error(
        `Invalid search alert digest: alerts=${alertCount}, previewAlerts=${previewAlerts.length}, vehicles=${vehicleCount}, previewVehicles=${previewVehicleCount}`,
      );
    }
    return {
      previewAlerts: [...previewAlerts],
      alertCount,
      vehicleCount,
      [searchAlertDigestBrand]: true,
    };
  },
} as const;
