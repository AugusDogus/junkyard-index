import type { YardType } from "~/lib/yard-service";

const selfServiceVehicles = [
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
  yardTypes: ["self_service"] satisfies YardType[],
  source: "pyp",
  locationName: "Fixture yard",
  availableDate: "2026-10-01",
  vin: vehicle.objectID,
}));

const vehicles = [
  ...selfServiceVehicles,
  ...[
    "full-740-1",
    "full-740-2",
    "full-740-3",
    "both-940",
    "self-940-1",
    "self-940-2",
    "unknown-960",
  ].map((id) => ({
    objectID: id,
    year: 1987,
    make: "Volvo",
    model: id.includes("740") ? "740" : "940",
    state: "Alabama",
    stateAbbr: "AL",
    source: "pyp",
    locationName: "Fixture yard",
    availableDate: "2026-10-01",
    vin: id,
    yardTypes: id.startsWith("both")
      ? ["self_service", "full_service"]
      : id.startsWith("self")
        ? ["self_service"]
        : id.startsWith("full")
          ? ["full_service"]
          : [],
  })),
];

type SearchParams = {
  query?: string;
  facetFilters?: unknown;
  page?: number;
  filters?: string;
};
type SearchRequest = { indexName: string; params?: SearchParams };

const client = {
  async search(
    input:
      | SearchRequest[]
      | { requests: (SearchParams & { indexName: string })[] },
  ) {
    if (typeof document !== "undefined") {
      const previous = Number(
        document.documentElement.dataset.searchRequests ?? 0,
      );
      document.documentElement.dataset.searchRequests = String(previous + 1);
    }
    const requests = Array.isArray(input)
      ? input
      : input.requests.map(({ indexName, ...params }) => ({
          indexName,
          params,
        }));
    return {
      results: requests.map(({ indexName, params }) => {
        if (indexName === "vehicles_distance") {
          throw new Error(
            "The retired distance index must not receive requests",
          );
        }
        const query = params?.query ?? "";
        const serializedFacets = JSON.stringify(params?.facetFilters ?? []);
        const self = serializedFacets.includes("yardTypes:self_service");
        const full = serializedFacets.includes("yardTypes:full_service");
        const expressionTypes = [
          ...(params?.filters ?? "").matchAll(
            /yardTypes:"(self_service|full_service)"/g,
          ),
        ].map((match) => match[1]);
        const extraOnly = params?.filters?.includes(
          "NOT yardTypes:self_service",
        );
        const hits = vehicles.filter(
          (vehicle) =>
            `${vehicle.make} ${vehicle.model}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (!JSON.stringify(params?.facetFilters ?? []).includes(
              "state:Alabama",
            ) ||
              vehicle.state === "Alabama") &&
            ((!self && !full) ||
              (self && vehicle.yardTypes.includes("self_service")) ||
              (full && vehicle.yardTypes.includes("full_service"))) &&
            (!expressionTypes.length ||
              expressionTypes.some(
                (type) =>
                  typeof type === "string" && vehicle.yardTypes.includes(type),
              )) &&
            (!extraOnly ||
              (vehicle.yardTypes.includes("full_service") &&
                !vehicle.yardTypes.includes("self_service"))),
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
            yardTypes: {
              self_service: hits.filter((hit) =>
                hit.yardTypes.includes("self_service"),
              ).length,
              full_service: hits.filter((hit) =>
                hit.yardTypes.includes("full_service"),
              ).length,
            },
            state: { Alabama: 2, California: 1 },
            make: { Toyota: 2, Ford: 1 },
          },
        };
      }),
    };
  },
};
export function liteClient() {
  return client;
}
