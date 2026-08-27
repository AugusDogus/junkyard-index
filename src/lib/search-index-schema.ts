export const VIN_PATTERN_SEARCH_SCHEMA_VERSION = 3;
export const ADVANCED_SEARCH_SCHEMA_VERSION = 4;
export const CURRENT_SEARCH_SCHEMA_VERSION = ADVANCED_SEARCH_SCHEMA_VERSION;
const SEARCH_SCHEMA_VERSION_KEY = "searchSchemaVersion";

export type SearchSchemaUserDataResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: "incompatible_user_data" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getSearchSchemaVersion(userData: unknown): number {
  if (!isRecord(userData)) return 0;

  const version = userData[SEARCH_SCHEMA_VERSION_KEY];
  return typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version >= 0
    ? version
    : 0;
}

export function isVinPatternSearchReady(userData: unknown): boolean {
  return getSearchSchemaVersion(userData) >= VIN_PATTERN_SEARCH_SCHEMA_VERSION;
}

export function isAdvancedSearchReady(userData: unknown): boolean {
  return getSearchSchemaVersion(userData) >= ADVANCED_SEARCH_SCHEMA_VERSION;
}

export function withSearchSchemaVersion(
  userData: unknown,
  version: number,
): SearchSchemaUserDataResult {
  if (userData !== null && userData !== undefined && !isRecord(userData)) {
    return { success: false, error: "incompatible_user_data" };
  }

  return {
    success: true,
    data: {
      ...(isRecord(userData) ? userData : {}),
      [SEARCH_SCHEMA_VERSION_KEY]: version,
    },
  };
}
