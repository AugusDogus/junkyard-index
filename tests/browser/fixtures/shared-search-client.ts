export { ALGOLIA_INDEX_NAME } from "~/lib/constants";

const vehicles = [
  {
    objectID: "venza-al",
    year: 2010,
    make: "Toyota",
    model: "Venza",
    state: "Alabama",
    stateAbbr: "AL",
  },
  {
    objectID: "venza-ca",
    year: 2011,
    make: "Toyota",
    model: "Venza",
    state: "California",
    stateAbbr: "CA",
  },
  {
    objectID: "ford-al",
    year: 2012,
    make: "Ford",
    model: "Focus",
    state: "Alabama",
    stateAbbr: "AL",
  },
].map((vehicle) => ({
  ...vehicle,
  source: "pyp",
  locationName: "Fixture yard",
  availableDate: "2026-10-01",
  vin: vehicle.objectID,
}));

const client = {
  async search(
    requests: {
      indexName: string;
      params?: { query?: string; facetFilters?: unknown; page?: number };
    }[],
  ) {
    if (typeof document !== "undefined") {
      const previous = Number(
        document.documentElement.dataset.searchRequests ?? 0,
      );
      document.documentElement.dataset.searchRequests = String(previous + 1);
    }
    return {
      results: requests.map(({ indexName, params }) => {
        const query = params?.query ?? "";
        const hits = vehicles.filter(
          (vehicle) =>
            `${vehicle.make} ${vehicle.model}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (!JSON.stringify(params?.facetFilters ?? []).includes(
              "state:Alabama",
            ) ||
              vehicle.state === "Alabama"),
        );
        return {
          index: indexName,
          query,
          hits,
          nbHits: hits.length,
          page: params?.page ?? 0,
          nbPages: 1,
          hitsPerPage: 1000,
          processingTimeMS: 1,
          exhaustiveNbHits: true,
          params: "",
          facets: {
            state: { Alabama: 2, California: 1 },
            make: { Toyota: 2, Ford: 1 },
          },
        };
      }),
    };
  },
};
export function getSearchClient() {
  return client;
}
