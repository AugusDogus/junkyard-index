import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as hyperbrowser from "@hyperbrowser/sdk";
import * as playwright from "playwright-core";
import { Effect } from "effect";
import { PypProviderError } from "./errors";
import { Config } from "./context";
import { streamPypInventory } from "./pyp-connector";
import {
  acquirePypSession,
  fetchRawPypFilterPage,
} from "./pyp-browser-session";

// Keep the real exports so these SDK mocks cannot leak into other test files.
const originalHyperbrowser = { ...hyperbrowser };
const originalPlaywright = { ...playwright };
const failure = new Error("PYP inventory request timed out after 30000ms");
const evaluate = mock<() => Promise<unknown>>(async () => undefined);
const goto = mock(async () => undefined);
const closePage = mock(async () => undefined);
const stopSession = mock(async () => undefined);
const page = { evaluate, goto, close: closePage };
const newPage = mock(async () => page);
const context = { pages: () => [], newPage, close: async () => undefined };
const newContext = mock(async () => context);
const browser = {
  contexts: () => [],
  newContext,
  close: async () => undefined,
};

mock.module("@hyperbrowser/sdk", () => ({
  Hyperbrowser: class {
    sessions = {
      create: async () => ({
        id: "mock-session",
        wsEndpoint: "mock://browser",
      }),
      stop: stopSession,
    };
  },
}));
mock.module("playwright-core", () => ({
  chromium: { connectOverCDP: async () => browser },
}));

afterAll(() => {
  mock.module("@hyperbrowser/sdk", () => originalHyperbrowser);
  mock.module("playwright-core", () => originalPlaywright);
});

beforeEach(() => {
  evaluate.mockReset();
  evaluate.mockResolvedValueOnce("mock-csrf-token").mockResolvedValueOnce([]);
  goto.mockReset().mockResolvedValue(undefined);
  closePage.mockReset().mockResolvedValue(undefined);
  stopSession.mockReset().mockResolvedValue(undefined);
  newPage.mockReset().mockResolvedValue(page);
  newContext.mockReset().mockResolvedValue(context);
});

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

function mockPypOpen(locations = rawLocations) {
  evaluate.mockReset();
  evaluate.mockResolvedValueOnce("mock-csrf-token");
  evaluate.mockResolvedValueOnce(locations);
}

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

function filterResponse(
  storeCode: string,
  requestedPage: number,
  vehicles: (typeof rawVehicle)[],
) {
  return {
    _error: false,
    data: {
      Success: true,
      Errors: [],
      ResponseData: {
        Request: {
          YardCode: [storeCode],
          Filter: "",
          PageSize: 500,
          PageNumber: requestedPage + 1,
          FilterDeals: false,
        },
        Vehicles: vehicles,
      },
      Messages: [],
    },
  };
}

const mockConfig = {
  hyperbrowserApiKey: "mock-api-key",
  betterStackHeartbeatUrl: undefined,
};

describe("PYP inventory pagination", () => {
  test("streams the first zero-based API page before checkpointing page one", async () => {
    mockPypOpen();
    evaluate.mockResolvedValueOnce(filterResponse("1265", 0, [rawVehicle]));

    const ingestedVins: string[] = [];
    const result = await Effect.runPromise(
      streamPypInventory({
        cursor: { source: "pyp", storeCodes: null, storeIndex: 0, page: 0 },
        maxPages: 1,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            ingestedVins.push(...vehicles.map((vehicle) => vehicle.vin));
          }),
      }).pipe(Effect.provideService(Config, mockConfig), Effect.scoped),
    );

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        path: expect.stringContaining("store=1265&filter=&page=0&pageSize=500"),
      }),
    );
    expect(result.status).toBe("paused");
    expect(result.cursor).toEqual({
      source: "pyp",
      storeCodes: Array.from({ length: 20 }, (_, index) =>
        String(1265 + index),
      ),
      storeIndex: 1,
      page: 0,
    });
    expect(result.pagesProcessed).toBe(1);
    expect(result.count).toBe(1);
    expect(ingestedVins).toEqual(["2HGFC2F84LH554430"]);
  });

  test("resumes a full store page before advancing to the next store", async () => {
    mockPypOpen();
    evaluate.mockResolvedValueOnce(
      filterResponse(
        "1265",
        0,
        Array.from({ length: 500 }, () => rawVehicle),
      ),
    );
    const first = await Effect.runPromise(
      streamPypInventory({
        cursor: { source: "pyp", storeCodes: null, storeIndex: 0, page: 0 },
        maxPages: 1,
        onBatch: () => Effect.void,
      }).pipe(Effect.provideService(Config, mockConfig), Effect.scoped),
    );
    expect(first.status).toBe("paused");
    expect(first.cursor).toMatchObject({ storeIndex: 0, page: 1 });

    mockPypOpen();
    evaluate.mockResolvedValueOnce(filterResponse("1265", 1, [rawVehicle]));
    const second = await Effect.runPromise(
      streamPypInventory({
        cursor: first.cursor,
        maxPages: 1,
        onBatch: () => Effect.void,
      }).pipe(Effect.provideService(Config, mockConfig), Effect.scoped),
    );
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        path: expect.stringContaining("store=1265&filter=&page=1&pageSize=500"),
      }),
    );
    expect(second.status).toBe("paused");
    expect(second.cursor).toMatchObject({ storeIndex: 1, page: 0 });
  });

  test("fails when the store list changes between chunks", async () => {
    mockPypOpen([
      ...rawLocations.slice(0, -1),
      { ...rawLocation, LocationCode: "9999" },
    ]);
    const result = await Effect.runPromise(
      streamPypInventory({
        cursor: {
          source: "pyp",
          storeCodes: rawLocations.map((location) => location.LocationCode),
          storeIndex: 1,
          page: 0,
        },
        maxPages: 1,
        onBatch: () => Effect.void,
      }).pipe(
        Effect.provideService(Config, mockConfig),
        Effect.scoped,
        Effect.either,
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") throw new Error("Expected changed-store error");
    expect(result.left.message).toContain("store list changed");
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  test("does not advance on a response for the wrong store", async () => {
    mockPypOpen();
    evaluate.mockResolvedValueOnce(filterResponse("1266", 0, [rawVehicle]));
    const result = await Effect.runPromise(
      streamPypInventory({
        cursor: { source: "pyp", storeCodes: null, storeIndex: 0, page: 0 },
        maxPages: 1,
        onBatch: () => Effect.void,
      }).pipe(Effect.provideService(Config, mockConfig), Effect.scoped),
    );
    expect(result.status).toBe("failed");
    expect(result.pagesProcessed).toBe(0);
    expect(result.cursor).toMatchObject({ storeIndex: 0, page: 0 });
    expect(result.errors[0]).toContain("response does not match");
  });

  test("completes after visiting every store, including empty stores", async () => {
    mockPypOpen();
    for (const location of rawLocations) {
      evaluate.mockResolvedValueOnce(
        filterResponse(location.LocationCode, 0, []),
      );
    }
    const result = await Effect.runPromise(
      streamPypInventory({
        cursor: { source: "pyp", storeCodes: null, storeIndex: 0, page: 0 },
        maxPages: 20,
        onBatch: () => Effect.void,
      }).pipe(Effect.provideService(Config, mockConfig), Effect.scoped),
    );
    expect(result.status).toBe("complete");
    expect(result.pagesProcessed).toBe(20);
    expect(result.count).toBe(0);
    expect(result.cursor).toMatchObject({ storeIndex: 20, page: 0 });
  });

  test("continues an in-flight legacy global-page run", async () => {
    mockPypOpen();
    evaluate.mockResolvedValueOnce(filterResponse("1265", 3, [rawVehicle]));
    const result = await Effect.runPromise(
      streamPypInventory({
        cursor: { source: "pyp", page: 3 },
        maxPages: 1,
        onBatch: () => Effect.void,
      }).pipe(Effect.provideService(Config, mockConfig), Effect.scoped),
    );
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        path: expect.stringContaining("&page=3&pageSize=500"),
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.cursor).toEqual({ source: "pyp", page: 4 });
  });
});

describe("PYP browser failure diagnostics", () => {
  test.each(["raw", "decoded"] as const)(
    "preserves the %s fetch rejection with phase and page",
    async (mode) => {
      evaluate.mockRejectedValueOnce(failure);
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            if (mode === "raw")
              return yield* fetchRawPypFilterPage("mock-api-key", 2, 500);
            const session = yield* acquirePypSession("mock-api-key");
            return yield* session.fetchFilterPage("", 2, 500);
          }),
        ).pipe(Effect.either),
      );
      expect(result._tag).toBe("Left");
      if (result._tag !== "Left")
        throw new Error("Expected browser fetch failure");
      expect(result.left.phase).toBe("fetch");
      expect(result.left.message).toBe(
        `Browser session fetch: PYP page 2: ${failure.message}`,
      );
      expect(result.left.cause).toBeInstanceOf(PypProviderError);
      if (!(result.left.cause instanceof PypProviderError))
        throw new Error("Expected PYP page context");
      expect(result.left.cause.cause).toBe(failure);
      expect(stopSession).toHaveBeenCalledTimes(1);
    },
  );

  test("reports a different page rejection without inferring a timeout", async () => {
    evaluate.mockRejectedValueOnce(new Error("Target page has been closed"));
    const result = await Effect.runPromise(
      Effect.scoped(fetchRawPypFilterPage("mock-api-key", 3, 500)).pipe(
        Effect.either,
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag !== "Left")
      throw new Error("Expected browser fetch failure");
    expect(result.left.message).toBe(
      "Browser session fetch: PYP page 3: Target page has been closed",
    );
  });

  test("preserves rotation errors after closing the previous session", async () => {
    const cause = new Error("PYP navigation failed");
    goto.mockResolvedValueOnce(undefined).mockRejectedValueOnce(cause);
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* acquirePypSession("mock-api-key");
          yield* session.reopen();
        }),
      ).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag !== "Left")
      throw new Error("Expected browser rotation failure");
    expect(result.left.message).toBe(
      `Browser session rotate: ${cause.message}`,
    );
    expect(result.left.cause).toBe(cause);
    expect(stopSession).toHaveBeenCalledTimes(2);
  });

  test("keeps best-effort cleanup from replacing a successful result", async () => {
    const raw = { vehicles: [] };
    evaluate.mockResolvedValueOnce({ _error: false, data: raw });
    closePage.mockRejectedValueOnce(new Error("Page already closed"));
    stopSession.mockRejectedValueOnce(new Error("Session already stopped"));
    const result = await Effect.runPromise(
      Effect.scoped(fetchRawPypFilterPage("mock-api-key", 1, 500)),
    );
    expect(result.raw).toBe(raw);
    expect(stopSession).toHaveBeenCalledTimes(1);
  });

  test.each(["context", "page", "navigation", "token", "locations"] as const)(
    "preserves %s opening errors",
    async (operation) => {
      const cause = new Error(`PYP ${operation} failed`);
      if (operation === "context") newContext.mockRejectedValueOnce(cause);
      if (operation === "page") newPage.mockRejectedValueOnce(cause);
      if (operation === "navigation") goto.mockRejectedValueOnce(cause);
      if (operation === "token" || operation === "locations") {
        evaluate.mockReset();
        if (operation === "locations")
          evaluate.mockResolvedValueOnce("mock-csrf-token");
        evaluate.mockRejectedValueOnce(cause);
      }
      const result = await Effect.runPromise(
        Effect.scoped(acquirePypSession("mock-api-key")).pipe(Effect.either),
      );
      expect(result._tag).toBe("Left");
      if (result._tag !== "Left")
        throw new Error("Expected browser open failure");
      expect(result.left.message).toBe(
        `Browser session open: ${cause.message}`,
      );
      expect(result.left.cause).toBe(cause);
      expect(stopSession).toHaveBeenCalledTimes(1);
    },
  );

  test("preserves a synchronous close error when reopening", async () => {
    const cause = new Error("PYP page close failed");
    closePage.mockImplementationOnce(() => {
      throw cause;
    });
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* acquirePypSession("mock-api-key");
          yield* session.reopen();
        }),
      ).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag !== "Left")
      throw new Error("Expected browser close failure");
    expect(result.left.message).toBe(`Browser session close: ${cause.message}`);
    expect(result.left.cause).toBe(cause);
  });
});
