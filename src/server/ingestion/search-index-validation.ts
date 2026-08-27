import { ALGOLIA_SEARCH_INDEX_NAMES } from "~/lib/constants";
import { VinPattern } from "~/lib/vin-pattern";

export class SearchIndexMigrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchIndexMigrationValidationError";
  }
}

export function buildVinFilterValidationRequests(vin: string) {
  const parsedPattern = VinPattern.parse(vin);
  if (!parsedPattern.success) {
    throw new SearchIndexMigrationValidationError(
      `Search index migration selected an invalid validation VIN: ${vin}`,
    );
  }

  const filters = VinPattern.toAlgoliaFilter(parsedPattern.data);
  if (!filters) {
    throw new SearchIndexMigrationValidationError(
      `Search index migration could not build a validation filter for VIN: ${vin}`,
    );
  }
  const advancedSearchFilter = `searchTokens:"${vin.toLocaleLowerCase("en-US")}"`;
  return ALGOLIA_SEARCH_INDEX_NAMES.map((indexName) => ({
    indexName,
    query: "",
    filters: `(${filters}) AND ${advancedSearchFilter}`,
    hitsPerPage: 1,
    attributesToRetrieve: ["objectID"],
  }));
}
