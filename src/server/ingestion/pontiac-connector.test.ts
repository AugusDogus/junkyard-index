import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamPontiacInventoryWithRequestGate } from "./pontiac-connector";
import { PontiacCursor, PontiacCursorSchema } from "./pontiac-cursor";
import { PontiacDetailSchema, PontiacSearchSchema } from "./pontiac-record";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { DURABLE_SOURCE_DEFINITIONS } from "./durable-source";
import {
  pontiacContactHtml,
  pontiacDetailRecord,
  pontiacSearchRecord,
} from "./pontiac-test-fixtures";
import type { PontiacCanonicalVehicle } from "./pontiac-transform";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const second = {
  ...pontiacSearchRecord,
  vehicleID: 15918205,
  stockID: "P52090",
};
function mockInventory(alter?: (url: URL, data: unknown) => unknown) {
  const requests: URL[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      let data: unknown;
      switch (url.pathname) {
        case "/used-car-parts-pontiac":
          data = pontiacContactHtml;
          break;
        case "/api/vehicles/recent/105":
          data = [
            {
              vehicleID: pontiacSearchRecord.vehicleID,
              storeNumber: 105,
              modelYear: 2007,
              vehicleMake: "NISSAN",
              modelName: "ARMADA",
            },
          ];
          break;
        case "/api/vehicles/years":
          data = [{ modelYear: 2020 }, { modelYear: 1990 }];
          break;
        case "/api/vehicles/make/2020":
        case "/api/vehicles/make/1990":
          data = [{ vehicleMake: "Nissan" }];
          break;
        case "/api/vehicles/model/2020/Nissan":
        case "/api/vehicles/model/1990/Nissan":
          data = [
            {
              hollanderModel: "Armada",
              trueModel: "ARMADA",
              mmdCD: "NIS",
              mmdCategory: url.pathname.includes("2020") ? "A" : "B",
            },
          ];
          break;
        case "/api/vehicles/search/":
          expect(url.searchParams.get("store")).toBe("105");
          expect(url.searchParams.get("make")).toBe("Nissan");
          data =
            url.searchParams.get("year") === "2020"
              ? [pontiacSearchRecord]
              : [pontiacSearchRecord, second];
          break;
        case "/api/vehicles/15918204":
          data = pontiacDetailRecord;
          break;
        case "/api/vehicles/15918205":
          data = {
            ...pontiacDetailRecord,
            vehicleID: second.vehicleID,
            stockID: second.stockID,
            VIN: "1GCEG25H8B4121375",
            images: [
              {
                referenceID: second.vehicleID,
                imageMedium:
                  "https://static.u-pullandsave.com/medium/3f794c11-068f-4ea9-b98a-de974e3817f7.jpg",
              },
            ],
          };
          break;
        default:
          throw new Error("Unexpected Pontiac test endpoint " + url);
      }
      const value = alter ? alter(url, data) : data;
      if (value instanceof Response) return value;
      return new Response(
        typeof value === "string" ? value : JSON.stringify(value),
        {
          headers: {
            "Content-Type":
              url.pathname === "/used-car-parts-pontiac"
                ? "text/html"
                : "application/json",
          },
        },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  startCursor: PontiacCursor = PontiacCursor.initial,
  maxPages = 16,
  onBatch = (_batch: PontiacCanonicalVehicle[]) => Effect.void,
) =>
  Effect.runPromise(
    streamPontiacInventoryWithRequestGate(
      { startCursor, maxPages, onBatch },
      gate,
    ),
  );

test("Pontiac traverses all mapping variants and resumes every request without duplicate donor emissions", async () => {
  const requests = mockInventory();
  const vehicles: PontiacCanonicalVehicle[] = [];
  let cursor: PontiacCursor = PontiacCursor.initial;
  let pages = 0;
  while (cursor.phase !== "complete") {
    const chunk = await run(cursor, 1, (batch) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      }),
    );
    expect(chunk.pagesProcessed).toBe(1);
    expect(chunk.status).toBe(
      chunk.cursor.phase === "complete" ? "complete" : "paused",
    );
    cursor = parseDurableSourceCursor(
      "pontiac",
      serializeDurableSourceCursor(chunk.cursor),
    );
    pages += chunk.pagesProcessed;
    if (pages > 20) throw new Error("Pontiac did not reach completion");
  }
  expect(pages).toBe(11);
  expect(
    requests.filter((u) => u.pathname === "/api/vehicles/search/"),
  ).toHaveLength(2);
  expect(vehicles.map((v) => v.stockNumber)).toEqual(["P52089", "P52090"]);
  expect(DURABLE_SOURCE_DEFINITIONS.pontiac.maxPagesPerChunk).toBe(16);
  expect((await run(cursor)).pagesProcessed).toBe(0);
  expect(requests).toHaveLength(11);
});

test("Pontiac stops when a recent arrival is missing from its enumerated union", async () => {
  mockInventory((url, data) =>
    url.pathname === "/api/vehicles/search/" ? [second] : data,
  );
  await expect(run()).rejects.toThrow("did not recover recent-arrival control");
});

test("Pontiac resumes donors with absent optional fields without stock or photo collisions", async () => {
  mockInventory((url, data) => {
    if (url.pathname === "/api/vehicles/search/")
      return PontiacSearchSchema.array()
        .parse(data)
        .map((donor) => ({
          ...donor,
          stockID: null,
          colorOfVehicle: null,
          yardRow: null,
        }));
    if (/^\/api\/vehicles\/\d+$/.test(url.pathname))
      return {
        ...PontiacDetailSchema.parse(data),
        stockID: null,
        colorOfVehicle: null,
        YardRow: null,
        YardLocationDT: null,
        images: [],
      };
    return data;
  });
  const vehicles: PontiacCanonicalVehicle[] = [];
  const onBatch = (batch: PontiacCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  const first = await run(PontiacCursor.initial, 10, onBatch);
  const cursor = parseDurableSourceCursor(
    "pontiac",
    serializeDurableSourceCursor(first.cursor),
  );
  expect(cursor).toMatchObject({ phase: "details", emitted: 1, images: [] });
  expect((await run(cursor, 16, onBatch)).status).toBe("complete");
  expect(vehicles).toHaveLength(2);
  for (const vehicle of vehicles)
    expect(vehicle).toMatchObject({
      stockNumber: null,
      color: null,
      row: null,
      availableDate: null,
      imageUrl: null,
    });
});

test.each(["2020", "1990"])(
  "Pontiac retains optional search metadata when the %s mapping omits it",
  async (missingYear) => {
    mockInventory((url, data) => {
      if (
        url.pathname === "/api/vehicles/search/" &&
        url.searchParams.get("year") === missingYear
      )
        return PontiacSearchSchema.array()
          .parse(data)
          .map((donor) => ({
            ...donor,
            stockID: null,
            colorOfVehicle: "UNKNOWN",
            yardRow: null,
          }));
      if (url.pathname === "/api/vehicles/15918204")
        return {
          ...pontiacDetailRecord,
          stockID: null,
          colorOfVehicle: null,
          YardRow: null,
        };
      return data;
    });
    const first = await run(PontiacCursor.initial, 8);
    const cursor = parseDurableSourceCursor(
      "pontiac",
      serializeDurableSourceCursor(first.cursor),
    );
    const vehicles: PontiacCanonicalVehicle[] = [];
    expect(
      (
        await run(cursor, 16, (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        )
      ).status,
    ).toBe("complete");
    expect(vehicles[0]).toMatchObject({
      stockNumber: "P52089",
      color: "Red",
      row: "16",
    });
  },
);

test("Pontiac stops on a saturated search before fetching any details", async () => {
  const requests = mockInventory((url, data) =>
    url.pathname === "/api/vehicles/search/"
      ? Array.from({ length: 100 }, (_, i) => ({
          ...pontiacSearchRecord,
          vehicleID: i + 1,
          stockID: "P" + (52000 + i),
        }))
      : data,
  );
  await expect(run()).rejects.toThrow("99");
  expect(requests.some((u) => /^\/api\/vehicles\/\d+$/.test(u.pathname))).toBe(
    false,
  );
});

test.each([{ stockID: "P99999" }, { colorOfVehicle: "BLUE" }, { yardRow: 17 }])(
  "Pontiac rejects contradictory donor records across searches: %j",
  async (patch) => {
    mockInventory((url, data) =>
      url.pathname === "/api/vehicles/search/" &&
      url.searchParams.get("year") === "1990"
        ? [{ ...pontiacSearchRecord, ...patch }]
        : data,
    );
    await expect(run()).rejects.toThrow("searches disagree");
  },
);

test("Pontiac rejects the same provided stock on different donors", async () => {
  mockInventory((url, data) =>
    url.pathname === "/api/vehicles/search/" &&
    url.searchParams.get("year") === "1990"
      ? [
          pontiacSearchRecord,
          { ...second, stockID: pontiacSearchRecord.stockID },
        ]
      : data,
  );
  await expect(run()).rejects.toThrow(
    "searches disagree on donor or stock identity",
  );
});

test("Pontiac checks detail-only stock uniqueness across serialized checkpoints", async () => {
  mockInventory((url, data) => {
    if (url.pathname === "/api/vehicles/search/")
      return PontiacSearchSchema.array()
        .parse(data)
        .map((donor) => ({
          ...donor,
          stockID: null,
        }));
    if (url.pathname === "/api/vehicles/15918205")
      return {
        ...PontiacDetailSchema.parse(data),
        stockID: pontiacSearchRecord.stockID,
      };
    return data;
  });
  const first = await run(PontiacCursor.initial, 10);
  const cursor = parseDurableSourceCursor(
    "pontiac",
    serializeDurableSourceCursor(first.cursor),
  );
  await expect(run(cursor)).rejects.toThrow("reuse stock");
});

test("Pontiac treats only native detail 404 as unavailable and preserves quality counts across resume", async () => {
  mockInventory((url, data) =>
    url.pathname.endsWith("/15918205")
      ? new Response("Not found", { status: 404 })
      : data,
  );
  const partial = await run(PontiacCursor.initial, 10);
  expect(partial.cursor).toMatchObject({
    phase: "details",
    index: 1,
    emitted: 1,
  });
  const final = await run(
    parseDurableSourceCursor(
      "pontiac",
      serializeDurableSourceCursor(partial.cursor),
    ),
  );
  expect(final.status).toBe("complete");
  expect(final.accounting).toMatchObject({
    recordsProcessed: 1,
    recordsExcluded: 1,
    recordsRejected: 0,
  });
});

test("Pontiac checks VIN uniqueness across serialized detail checkpoints", async () => {
  mockInventory((url, data) =>
    url.pathname.endsWith("/15918205") &&
    typeof data === "object" &&
    data !== null
      ? { ...data, VIN: pontiacDetailRecord.VIN }
      : data,
  );
  const first = await run(PontiacCursor.initial, 10);
  expect(
    PontiacCursorSchema.safeParse({ ...first.cursor, vins: [] }).success,
  ).toBe(false);
  await expect(run(first.cursor)).rejects.toThrow("reuse VIN");
});

test("Pontiac checks photo uniqueness across serialized detail checkpoints", async () => {
  mockInventory((url, data) =>
    url.pathname.endsWith("/15918205") &&
    typeof data === "object" &&
    data !== null
      ? {
          ...data,
          images: [
            { ...pontiacDetailRecord.images[0], referenceID: second.vehicleID },
          ],
        }
      : data,
  );
  const first = await run(PontiacCursor.initial, 10);
  await expect(run(first.cursor)).rejects.toThrow("reuse the same photo");
});

test("Pontiac refuses oversized bodies and redirects", async () => {
  mockInventory((url, data) =>
    url.pathname === "/api/vehicles/years"
      ? new Response(" ".repeat(4 * 1024 * 1024 + 1), {
          headers: { "Content-Type": "application/json" },
        })
      : data,
  );
  await expect(run()).rejects.toThrow("exceeds 4 MiB");
  mockInventory((url, data) => {
    if (url.pathname !== "/api/vehicles/years") return data;
    const response = new Response("[]", {
      headers: { "Content-Type": "application/json" },
    });
    Object.defineProperty(response, "url", {
      value: "https://u-pullandsave.com/login",
    });
    return response;
  });
  await expect(run()).rejects.toThrow("redirected away");
});

test("Pontiac retains rejected VIN presence and fails excessive rejection at completion", async () => {
  mockInventory((url, data) =>
    url.pathname.endsWith("/15918204")
      ? {
          ...pontiacDetailRecord,
          images: [{ ...pontiacDetailRecord.images[0], referenceID: 1 }],
        }
      : data,
  );
  const first = await run(PontiacCursor.initial, 10);
  expect(first.count).toBe(0);
  expect(first.observedVins).toEqual([pontiacDetailRecord.VIN]);
  expect(first.cursor).toMatchObject({
    phase: "details",
    index: 1,
    rejected: 1,
    emitted: 0,
  });
  await expect(run(first.cursor)).rejects.toThrow(
    "failed completion quality guard",
  );
});

test.each([403, 500])(
  "Pontiac propagates HTTP %i without accepting an empty catalog",
  async (status) => {
    mockInventory((url, data) =>
      url.pathname === "/api/vehicles/years"
        ? new Response("Failed", { status })
        : data,
    );
    await expect(run()).rejects.toThrow("HTTP " + status);
  },
);

test.each([
  () =>
    new Response("[]", {
      status: 206,
      headers: { "Content-Type": "application/json" },
    }),
  () => new Response("[]", { headers: { "Content-Type": "text/html" } }),
  () =>
    new Response("[]", {
      headers: { "Content-Type": "application/json", "Content-Length": "100" },
    }),
  () =>
    new Response("[]", {
      headers: {
        "Content-Type": "application/json",
        "Content-Range": "bytes 0-1/3",
      },
    }),
  () => new Response("[", { headers: { "Content-Type": "application/json" } }),
])(
  "Pontiac rejects partial, mislabeled, truncated or invalid native responses",
  async (response) => {
    mockInventory((url, data) =>
      url.pathname === "/api/vehicles/years" ? response() : data,
    );
    await expect(run()).rejects.toThrow("No advanced checkpoint accepted");
  },
);

test("Pontiac rejects changed official contact metadata", async () => {
  mockInventory((url, data) =>
    url.pathname === "/used-car-parts-pontiac"
      ? pontiacContactHtml.replace("48340", "48341")
      : data,
  );
  await expect(run()).rejects.toThrow("contact identity changed");
});

test("Pontiac rejects malformed checkpoint evidence and invalid budgets before requests", async () => {
  const requests = mockInventory();
  expect(
    PontiacCursorSchema.safeParse({
      source: "pontiac",
      phase: "details",
      donors: [pontiacSearchRecord],
      index: 0,
      rejected: 1,
      emitted: 0,
      excluded: 0,
      vins: [],
      images: [],
    }).success,
  ).toBe(false);
  expect(() =>
    parseDurableSourceCursor("pontiac", '{"phase":"search","index":1}'),
  ).toThrow("Invalid pontiac ingestion cursor");
  await expect(run(PontiacCursor.initial, 0)).rejects.toThrow(
    "request budget is invalid",
  );
  expect(requests).toHaveLength(0);
});
