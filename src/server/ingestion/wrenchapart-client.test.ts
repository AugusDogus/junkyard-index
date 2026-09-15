import { afterEach, expect, test } from "bun:test";
import { Effect, Either, Schema } from "effect";
import fixture from "./fixtures/wrenchapart-sample.json";
import {
  fetchWrenchApartLocations,
  fetchWrenchApartVehicles,
  WrenchApartLocationSchema,
  WrenchApartVehicleSchema,
} from "./wrenchapart-client";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("decodes only consumed public fields and permits missing metadata", () => {
  const vehicle = Schema.decodeUnknownSync(WrenchApartVehicleSchema)(
    fixture.vehicle,
  );
  expect(vehicle).toMatchObject({
    yard: 2,
    make: { name: "NISSAN" },
    row: { id: 17 },
  });
  expect(vehicle.row).not.toHaveProperty("latitude");
  expect(
    Schema.decodeUnknownSync(WrenchApartLocationSchema)({ id: 99 }),
  ).toEqual({ id: 99 });
});

test("requests the complete yard array with the documented locationId filter", async () => {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(input));
      expect(init?.method).toBe("GET");
      return Response.json(
        String(input).endsWith("/locations")
          ? [fixture.location]
          : [fixture.vehicle],
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  expect(await Effect.runPromise(fetchWrenchApartLocations())).toHaveLength(1);
  expect(await Effect.runPromise(fetchWrenchApartVehicles(2))).toHaveLength(1);
  expect(requests).toEqual([
    "https://api.wrenchapart.com/locations",
    "https://api.wrenchapart.com/v1/vehicles?locationId=2",
  ]);
});

test.each([
  {
    name: "HTTP failure",
    response: () => new Response("unavailable", { status: 403 }),
  },
  { name: "invalid JSON", response: () => new Response("<html>error</html>") },
  {
    name: "changed array envelope",
    response: () =>
      Response.json({ vehicles: [fixture.vehicle], next: "page2" }),
  },
  {
    name: "invalid yard ID",
    response: () => Response.json([{ ...fixture.vehicle, yard: "2" }]),
  },
  {
    name: "partial response",
    response: () => Response.json([fixture.vehicle], { status: 206 }),
  },
  {
    name: "pagination link",
    response: () =>
      Response.json([fixture.vehicle], {
        headers: { Link: '</next>; rel="next"' },
      }),
  },
])("fails closed on $name", async ({ response }) => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests += 1;
      return response();
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.either(fetchWrenchApartVehicles(2)),
  );
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left._tag).toBe("WrenchApartProviderError");
    expect(result.left.message).toContain("locationId=2");
  }
  expect(requests).toBe(1);
});
