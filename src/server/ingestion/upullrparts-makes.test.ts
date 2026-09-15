import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Either, Schema } from "effect";
import vehicle from "./fixtures/upullrparts-vehicle.json";
import miniModels from "./fixtures/upullrparts-models-mini.json";
import {
  UPULLRPARTS_MAX_MAKES,
  UpullRPartsMakesSchema,
  UpullRPartsModelsSchema,
} from "./upullrparts-client";
import { loadUpullRPartsMakeResolver } from "./upullrparts-makes";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockDirectory(
  makes: unknown,
  partitions: ReadonlyMap<string, unknown>,
  models = new Map<string, unknown>(),
) {
  const requests: URLSearchParams[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      requests.push(params);
      if (params.get("apiAction") === "getMakes") return Response.json(makes);
      if (params.get("apiAction") === "getModels") {
        const response = models.get(params.get("Make") ?? "");
        return response === undefined
          ? new Response("missing fixture", { status: 403 })
          : Response.json(response);
      }
      const response = partitions.get(params.get("makes") ?? "");
      return response === undefined
        ? new Response("missing fixture", { status: 403 })
        : Response.json(response);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

describe("U Pull R Parts authoritative make resolution", () => {
  test("uses complete explicit make partitions, preserves raw make filters, and skips unused model lookups", async () => {
    const requests = mockDirectory(
      ["Ram ", "Ford"],
      new Map([
        ["Ram ", [vehicle]],
        ["Ford", []],
      ]),
    );
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver([vehicle], (request) => request),
    );
    // Intentionally counterintuitive fixture label proves no model-name/VIN inference.
    expect(resolve(vehicle)).toEqual({ status: "resolved", make: "Ram" });
    expect(requests).toHaveLength(3);
    expect(requests[1]?.toString()).toBe(
      "action=doApiCall&apiAction=getVehicles&makes=Ram+&models=0&years=0&beginDate=&endDate=",
    );
    expect(requests.every((params) => !params.has("site"))).toBe(true);
  });

  test("joins identities using store, stock, VIN, year and model instead of VIN alone", async () => {
    const variants = [
      { ...vehicle, Store: 2 },
      { ...vehicle, StockNumber: "different" },
      { ...vehicle, VIN: "different" },
      { ...vehicle, Year: 2014 },
      { ...vehicle, Model: "different" },
    ];
    mockDirectory(
      ["Ford"],
      new Map([["Ford", variants]]),
      new Map([["Ford", []]]),
    );
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver([vehicle], (request) => request),
    );
    expect(resolve(vehicle).status).toBe("unresolved");
  });

  test("uses the unique complete model directory for vehicles missing from all partitions", async () => {
    const row = { ...vehicle, Model: " mini cooper " };
    const requests = mockDirectory(
      ["MINI", "Ford"],
      new Map([
        ["MINI", []],
        ["Ford", []],
      ]),
      new Map([
        ["MINI", miniModels],
        ["Ford", ["FOCUS"]],
      ]),
    );
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver([row], (request) => request),
    );
    expect(resolve(row)).toEqual({ status: "resolved", make: "Mini" });
    expect(requests).toHaveLength(5);
    expect(requests[3]?.toString()).toBe(
      "action=doApiCall&apiAction=getModels&Make=MINI&ModelYear=0",
    );
    expect(requests[4]?.get("Make")).toBe("Ford");
  });

  test("does not select the first make for ambiguous provider model relations", async () => {
    mockDirectory(
      ["Dodge", "Ford"],
      new Map([
        ["Dodge", []],
        ["Ford", []],
      ]),
      new Map([
        ["Dodge", ["FOCUS"]],
        ["Ford", ["FOCUS"]],
      ]),
    );
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver([vehicle], (request) => request),
    );
    expect(resolve(vehicle)).toEqual({
      status: "unresolved",
      reason: "ambiguous provider model relation (Dodge, Ford)",
    });
  });

  test("reports conflicting partitions instead of using provider enumeration order", async () => {
    mockDirectory(
      ["Dodge", "Ford"],
      new Map([
        ["Dodge", [vehicle]],
        ["Ford", [vehicle]],
      ]),
    );
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver([vehicle], (request) => request),
    );
    expect(resolve(vehicle)).toEqual({
      status: "unresolved",
      reason: "conflicting make partitions (Dodge, Ford)",
    });
  });

  test("retains a real partition make even when the model label is UNKNOWN", async () => {
    const row = { ...vehicle, Model: "UNKNOWN" };
    mockDirectory(["Honda"], new Map([["Honda", [row]]]));
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver([row], (request) => request),
    );
    expect(resolve(row)).toEqual({ status: "resolved", make: "Honda" });
  });

  test.each(
    [
      [],
      [""],
      [" "],
      [1],
      { makes: ["Ford"] },
      Array.from({ length: UPULLRPARTS_MAX_MAKES + 1 }, (_, i) => `make-${i}`),
    ].map((makes) => ({ makes })),
  )("rejects an invalid or oversized make directory: %j", async ({ makes }) => {
    const requests = mockDirectory(makes, new Map());
    const result = await Effect.runPromise(
      Effect.either(
        loadUpullRPartsMakeResolver([vehicle], (request) => request),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(requests).toHaveLength(1);
  });

  test("rejects duplicate normalized makes before requesting their partitions", async () => {
    const requests = mockDirectory(["Ford", "FORD "], new Map());
    const result = await Effect.runPromise(
      Effect.either(
        loadUpullRPartsMakeResolver([vehicle], (request) => request),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(requests).toHaveLength(1);
  });

  test("fails missing or invalid partition responses rather than returning Other", async () => {
    for (const partitions of [
      new Map<string, unknown>(),
      new Map([["Ford", { error: "failed" }]]),
    ]) {
      mockDirectory(["Ford"], partitions);
      const result = await Effect.runPromise(
        Effect.either(
          loadUpullRPartsMakeResolver([vehicle], (request) => request),
        ),
      );
      expect(result._tag).toBe("Left");
    }
  });

  test("fails a broken supporting model lookup instead of treating it as an empty directory", async () => {
    mockDirectory(
      ["MINI"],
      new Map([["MINI", []]]),
      new Map([["MINI", { models: miniModels }]]),
    );
    const result = await Effect.runPromise(
      Effect.either(
        loadUpullRPartsMakeResolver([vehicle], (request) => request),
      ),
    );
    expect(result._tag).toBe("Left");
  });

  test("validates real supporting labels and rejects overlarge model responses", () => {
    expect(
      Either.isRight(
        Schema.decodeUnknownEither(UpullRPartsMakesSchema)(["MINI", "Ram "]),
      ),
    ).toBe(true);
    expect(
      Either.isRight(
        Schema.decodeUnknownEither(UpullRPartsModelsSchema)(miniModels),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        Schema.decodeUnknownEither(UpullRPartsModelsSchema)(
          Array.from({ length: 501 }, () => "MODEL"),
        ),
      ),
    ).toBe(true);
  });
});
