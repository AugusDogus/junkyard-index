import { createMemoryCache, type Requester } from "@algolia/client-common";
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
  hitsPerPage?: number;
  filters?: string;
  numericFilters?: unknown;
  aroundLatLng?: string;
  aroundRadius?: number | "all";
};
type SearchRequest = { indexName: string; params?: SearchParams };

/** Searches the server render ran. Production pays quota for each one. */
export const serverSearches = { count: 0 };

/** The key the app's client searches with now. */
let currentApiKey: string | undefined;

/** The requester the app built its client with, as the real client keeps it. */
let transport: Requester | undefined;

const client = {
  // Like the real lite client: InstantSearch hydrates server-rendered
  // results only into a client with a transporter cache and an agent.
  transporter: { responsesCache: createMemoryCache() },
  addAlgoliaAgent(_segment: string, _version?: string) {},
  /** Browser searches record the key they were sent with. */
  setClientApiKey({ apiKey }: { apiKey: string }) {
    currentApiKey = apiKey;
    if (typeof document !== "undefined")
      document.documentElement.dataset.searchApiKey = apiKey;
  },
  async search(
    input:
      | SearchRequest[]
      | { requests: (SearchParams & { indexName: string })[] },
  ) {
    if (typeof document === "undefined") serverSearches.count += 1;
    // Algolia refuses this key, as it refuses an expired secured key.
    if (
      typeof document !== "undefined" &&
      currentApiKey === "fixture-rejected-key"
    ) {
      const previous = Number(
        document.documentElement.dataset.rejectedSearches ?? 0,
      );
      document.documentElement.dataset.rejectedSearches = String(previous + 1);
      throw Object.assign(new Error("Invalid Application-ID or API key"), {
        name: "ApiError",
        status: 403,
      });
    }
    // A query of "blocked" answers as a blocked Algolia app does.
    if (
      (Array.isArray(input) ? input : input.requests).some((request) =>
        JSON.stringify(request).includes('"query":"blocked"'),
      )
    ) {
      if (typeof document !== "undefined") {
        const previous = Number(
          document.documentElement.dataset.blockedSearches ?? 0,
        );
        document.documentElement.dataset.blockedSearches = String(previous + 1);
      }
      throw Object.assign(new Error("Application is blocked"), {
        name: "ApiError",
        status: 403,
      });
    }
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
    // Send each search through the app's requester, as the real client's
    // transporter does, so a meter wrapped around it sees the call. The
    // answer still comes from this mock, so the send is not awaited.
    if (typeof document !== "undefined" && transport) {
      void transport
        .send({
          url: `${location.origin}/__algolia/1/indexes/*/queries`,
          method: "POST",
          headers: {},
          connectTimeout: 2000,
          responseTimeout: 5000,
          data: JSON.stringify({ requests }),
        })
        .catch(() => undefined);
    }
    if (typeof document !== "undefined") {
      const previous: unknown = JSON.parse(
        document.documentElement.dataset.searchQueryLog ?? "[]",
      );
      const log: unknown[] = Array.isArray(previous) ? previous : [];
      log.push(...requests);
      document.documentElement.dataset.searchQueryLog = JSON.stringify(log);
    }
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
        const arrivalVehicles = [
          { id: "arrival-yard", age: 3600, kind: "yard", lat: 33.448 },
          { id: "arrival-seen", age: 3 * 86400, kind: "seen", lat: 33.448 },
          { id: "arrival-old", age: 10 * 86400, kind: "yard", lat: 33.448 },
          { id: "arrival-unknown", age: 0, kind: "unknown", lat: 33.448 },
          { id: "arrival-far", age: 3600, kind: "yard", lat: 40 },
        ].map((item) => {
          const date = new Date(Date.now() - item.age * 1000).toISOString();
          return {
            objectID: item.id,
            year: 2010,
            make: "New",
            model: "Arrivals",
            state: "Arizona",
            stateAbbr: "AZ",
            source: "pyp",
            locationName: "Fixture yard",
            vin: item.id,
            yardTypes: ["self_service"],
            _geoloc: { lat: item.lat, lng: -112.074 },
            availableDate: item.kind === "yard" ? date : null,
            arrivalDate:
              item.kind === "unknown"
                ? { kind: "unknown" }
                : { kind: item.kind, date },
            availableDateTs:
              item.kind === "unknown" ? 0 : Math.floor(Date.parse(date) / 1000),
          };
        });
        const matchingVehicles =
          query === "arrivals"
            ? arrivalVehicles
            : query.startsWith("pagination")
              ? Array.from({ length: 96 }, (_, index) => ({
                  yardTypes: ["self_service"],
                  source: "pyp",
                  locationName: "Fixture yard",
                  availableDate: "2026-10-01",
                  state: "Alabama",
                  stateAbbr: "AL",
                  objectID: `pagination-${index}`,
                  year: 1900 + index,
                  make: "Pagination",
                  model: "Car",
                  vin: `VIN${index}`,
                  detailsUrl: "https://example.com/vehicle",
                  imageUrl: "https://example.com/car.jpg",
                }))
              : vehicles;
        const matched = matchingVehicles.filter(
          (vehicle) =>
            (!params?.filters?.includes("availableDateTs >=") ||
              ("availableDateTs" in vehicle &&
                typeof vehicle.availableDateTs === "number" &&
                vehicle.availableDateTs >=
                  Number(
                    params.filters.match(/availableDateTs >= (\d+)/)?.[1],
                  ) &&
                vehicle.availableDateTs <=
                  Number(
                    params.filters.match(/availableDateTs <= (\d+)/)?.[1],
                  ))) &&
            (!params?.aroundLatLng ||
              !("_geoloc" in vehicle) ||
              vehicle._geoloc.lat === 33.448) &&
            [
              ...`${params?.filters ?? ""} ${JSON.stringify(params?.numericFilters ?? [])}`.matchAll(
                /year\s*(>=|<=|=|>|<)\s*(\d+)/g,
              ),
            ].every((match) => {
              const year = Number(match[2]);
              switch (match[1]) {
                case ">=":
                  return vehicle.year >= year;
                case "<=":
                  return vehicle.year <= year;
                case ">":
                  return vehicle.year > year;
                case "<":
                  return vehicle.year < year;
                default:
                  return vehicle.year === year;
              }
            }) &&
            (query.startsWith("pagination") ||
              `${vehicle.make} ${vehicle.model}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
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
        const sorted =
          query.startsWith("pagination") && !indexName.includes("oldest")
            ? [...matched].reverse()
            : matched;
        const pageSize = params?.hitsPerPage ?? 24;
        const page = params?.page ?? 0;
        const hits = sorted.slice(page * pageSize, (page + 1) * pageSize);
        return {
          index: indexName,
          query,
          hits,
          nbHits: matched.length,
          page: params?.page ?? 0,
          nbPages: pageSize > 0 ? Math.ceil(matched.length / pageSize) : 0,
          hitsPerPage: pageSize,
          processingTimeMS: 1,
          exhaustiveNbHits: true,
          params: "",
          facets: {
            yardTypes: {
              self_service: matched.filter((hit) =>
                hit.yardTypes.includes("self_service"),
              ).length,
              full_service: matched.filter((hit) =>
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
/** Like algoliasearch's, this refuses to build a client without a key. */
export function liteClient(
  appId: unknown,
  apiKey: unknown,
  options?: { requester?: Requester },
) {
  if (!appId || typeof appId !== "string")
    throw new Error("`appId` is missing.");
  if (!apiKey || typeof apiKey !== "string")
    throw new Error("`apiKey` is missing.");
  transport = options?.requester;
  client.setClientApiKey({ apiKey });
  return client;
}
