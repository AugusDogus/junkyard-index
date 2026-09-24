import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { PypSessionError } from "./errors";
import { decodePypFilterResponse, decodePypLocations } from "./pyp-api";
import { streamPypInventory } from "./pyp-connector";
import * as directPypSession from "./pyp-direct-session";
import type { PypSession } from "./pyp-direct-session";

const originalDirectPypSession = { ...directPypSession };
const rawLocation = {
  LocationCode: "1265",
  LocationPageURL: "https://www.pyp.com/inventory/test-1265/",
  Name: "PYP Test",
  DisplayName: "Test",
  Address: "1 Main St",
  City: "Test",
  State: "California",
  StateAbbr: "CA",
  Zip: "90000",
  Phone: "555-0100",
  Lat: 34,
  Lng: -118,
  Distance: 0,
  LegacyCode: "265",
  Primo: "",
  Urls: {
    Store: "",
    Interchange: "",
    Inventory: "",
    Prices: "",
    Directions: "",
    SellACar: "",
    Contact: "",
    CustomerServiceChat: null,
    CarbuyChat: null,
    Deals: "",
    Parts: "",
  },
};
const rawLocations = Array.from({ length: 20 }, (_, index) => ({
  ...rawLocation,
  LocationCode: String(1265 + index),
}));
const locations = decodePypLocations(rawLocations);
const storeCodes = locations.map((location) => location.locationCode);
const initialCursor = {
  source: "pyp" as const,
  storeCodes: null,
  storeIndex: 0 as const,
  page: 0 as const,
};
const rawVehicle = {
  YardCode: "1265",
  Section: "Yard",
  Row: "1",
  SpaceNumber: "2",
  Color: "Blue",
  Year: "2020",
  Make: "HONDA",
  Model: "CIVIC",
  InYardDate: "2026-02-05T14:07:19Z",
  StockNumber: "1265-1",
  Vin: "2HGFC2F84LH554430",
  Photos: [],
};

function response(storeCode: string, page: number, vehicles: unknown[]) {
  return decodePypFilterResponse({
    Success: true,
    Errors: [],
    ResponseData: {
      Request: {
        YardCode: [storeCode],
        Filter: "",
        PageSize: 500,
        PageNumber: page + 1,
        FilterDeals: false,
      },
      Vehicles: vehicles,
    },
    Messages: [],
  });
}

const sessionState: { current: PypSession | null } = { current: null };
mock.module("./pyp-direct-session", () => ({
  acquireDirectPypSession: () => {
    const session = sessionState.current;
    if (session === null) throw new Error("PYP test session is missing");
    return Effect.succeed(session);
  },
}));

afterAll(() => {
  mock.module("./pyp-direct-session", () => originalDirectPypSession);
});

beforeEach(() => {
  sessionState.current = null;
});

function useSession(
  fetchFilterPage: PypSession["fetchFilterPage"],
  codes = locations,
) {
  sessionState.current = { locations: codes, fetchFilterPage };
}

test("starts at each store's first page and checkpoints the next page", async () => {
  const fetchPage = mock((storeCode: string, page: number, _size: number) =>
    Effect.succeed(
      response(
        storeCode,
        page,
        Array.from({ length: 500 }, () => rawVehicle),
      ),
    ),
  );
  useSession(fetchPage);
  const batches: number[] = [];
  const first = await Effect.runPromise(
    streamPypInventory({
      cursor: initialCursor,
      maxPages: 1,
      onBatch: (vehicles) =>
        Effect.sync(() => {
          batches.push(vehicles.length);
        }),
    }).pipe(Effect.scoped),
  );

  expect(fetchPage).toHaveBeenCalledWith("1265", 0, 500);
  expect(first.status).toBe("paused");
  expect(first.count).toBe(500);
  expect(first.cursor).toEqual({
    source: "pyp",
    storeCodes,
    storeIndex: 0,
    page: 1,
  });
  expect(batches).toEqual([500]);
});

test("resumes a full page and completes the remaining stores", async () => {
  const fetchPage = mock((storeCode: string, page: number, _size: number) => {
    let vehicles: (typeof rawVehicle)[] = [];
    if (storeCode === "1265") {
      vehicles =
        page === 0
          ? Array.from({ length: 500 }, () => rawVehicle)
          : [rawVehicle];
    }
    return Effect.succeed(response(storeCode, page, vehicles));
  });
  useSession(fetchPage);
  const first = await Effect.runPromise(
    streamPypInventory({
      cursor: initialCursor,
      maxPages: 1,
      onBatch: () => Effect.void,
    }).pipe(Effect.scoped),
  );
  const resumed = await Effect.runPromise(
    streamPypInventory({
      cursor: first.cursor,
      maxPages: 20,
      onBatch: () => Effect.void,
    }).pipe(Effect.scoped),
  );

  expect(fetchPage).toHaveBeenCalledWith("1265", 1, 500);
  expect(fetchPage).toHaveBeenCalledWith("1284", 0, 500);
  expect(fetchPage).toHaveBeenCalledTimes(21);
  expect(resumed.status).toBe("complete");
  expect(resumed.pagesProcessed).toBe(20);
  expect(resumed.cursor).toMatchObject({ storeIndex: 20, page: 0 });
});

test("keeps the cursor on a direct HTTP failure", async () => {
  const fetchPage = mock((_storeCode: string, _page: number, _size: number) =>
    Effect.fail(
      new PypSessionError({
        phase: "fetch",
        cause: new Error("HTTP 403"),
      }),
    ),
  );
  useSession(fetchPage);
  const result = await Effect.runPromise(
    streamPypInventory({
      cursor: initialCursor,
      maxPages: 1,
      onBatch: () => Effect.void,
    }).pipe(Effect.scoped),
  );

  expect(fetchPage).toHaveBeenCalledTimes(1);
  expect(result.status).toBe("failed");
  expect(result.pagesProcessed).toBe(0);
  expect(result.cursor).toEqual({
    source: "pyp",
    storeCodes,
    storeIndex: 0,
    page: 0,
  });
  expect(result.errors[0]).toContain("HTTP 403");
});

test("rejects a response for another store without advancing", async () => {
  useSession(() => Effect.succeed(response("1266", 0, [rawVehicle])));
  const result = await Effect.runPromise(
    streamPypInventory({
      cursor: initialCursor,
      maxPages: 1,
      onBatch: () => Effect.void,
    }).pipe(Effect.scoped),
  );

  expect(result.status).toBe("failed");
  expect(result.pagesProcessed).toBe(0);
  expect(result.cursor).toMatchObject({ storeIndex: 0, page: 0 });
  expect(result.errors[0]).toContain("response does not match");
});

test("rejects a changed store directory before fetching", async () => {
  const fetchPage = mock((_storeCode: string, _page: number, _size: number) =>
    Effect.succeed(response("1265", 0, [])),
  );
  useSession(
    fetchPage,
    decodePypLocations([
      ...rawLocations.slice(0, -1),
      { ...rawLocation, LocationCode: "9999" },
    ]),
  );
  const result = await Effect.runPromise(
    streamPypInventory({
      cursor: { source: "pyp", storeCodes, storeIndex: 1, page: 0 },
      maxPages: 1,
      onBatch: () => Effect.void,
    }).pipe(Effect.scoped, Effect.either),
  );

  expect(result._tag).toBe("Left");
  if (result._tag !== "Left") throw new Error("Expected changed-store error");
  expect(result.left.message).toContain("store list changed");
  expect(fetchPage).not.toHaveBeenCalled();
});
