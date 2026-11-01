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

function mockDirectory(makes: unknown, models = new Map<string, unknown>()) {
  const requests: URLSearchParams[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      requests.push(params);
      if (params.get("apiAction") === "getMakes") return Response.json(makes);
      const response =
        params.get("apiAction") === "getModels"
          ? models.get(params.get("Make") ?? "")
          : undefined;
      return response === undefined
        ? new Response("missing fixture", { status: 403 })
        : Response.json(response);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

describe("U Pull R Parts make resolution", () => {
  test("uses the unique model directory relation and preserves raw make labels", async () => {
    const row = { ...vehicle, Model: " mini cooper " };
    const requests = mockDirectory(
      ["MINI", "Ram ", "Ford"],
      new Map<string, unknown>([
        ["MINI", miniModels],
        ["Ram ", ["1500"]],
        ["Ford", ["FOCUS"]],
      ]),
    );
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver((request) => request),
    );
    expect(resolve(row)).toEqual({ status: "resolved", make: "Mini" });
    expect(requests.map((params) => params.toString())).toEqual([
      "action=doAaaApiCall&apiAction=getMakes",
      "action=doAaaApiCall&apiAction=getModels&Make=MINI&ModelYear=0",
      "action=doAaaApiCall&apiAction=getModels&Make=Ram+&ModelYear=0",
      "action=doAaaApiCall&apiAction=getModels&Make=Ford&ModelYear=0",
    ]);
  });

  test("does not select the first make for ambiguous provider model relations", async () => {
    mockDirectory(
      ["Dodge", "Ford"],
      new Map([
        ["Dodge", ["FOCUS"]],
        ["Ford", ["FOCUS"]],
      ]),
    );
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver((request) => request),
    );
    expect(resolve(vehicle)).toEqual({
      status: "unresolved",
      reason: "ambiguous provider model relation (Dodge, Ford)",
    });
  });

  test("leaves a model missing from every directory unresolved", async () => {
    mockDirectory(["Ford"], new Map([["Ford", ["ESCAPE"]]]));
    const resolve = await Effect.runPromise(
      loadUpullRPartsMakeResolver((request) => request),
    );
    expect(resolve(vehicle)).toEqual({
      status: "unresolved",
      reason: "no matching provider model relation",
    });
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
    const requests = mockDirectory(makes);
    const result = await Effect.runPromise(
      Effect.either(loadUpullRPartsMakeResolver((request) => request)),
    );
    expect(result._tag).toBe("Left");
    expect(requests).toHaveLength(1);
  });

  test("rejects duplicate normalized makes before requesting their models", async () => {
    const requests = mockDirectory(["Ford", "FORD "]);
    const result = await Effect.runPromise(
      Effect.either(loadUpullRPartsMakeResolver((request) => request)),
    );
    expect(result._tag).toBe("Left");
    expect(requests).toHaveLength(1);
  });

  test("fails a broken supporting model lookup instead of treating it as an empty directory", async () => {
    mockDirectory(["MINI"], new Map([["MINI", { models: miniModels }]]));
    const result = await Effect.runPromise(
      Effect.either(loadUpullRPartsMakeResolver((request) => request)),
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
