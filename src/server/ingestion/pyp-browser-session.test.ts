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

describe("PYP inventory pagination", () => {
  test("streams the first zero-based API page before checkpointing page one", async () => {
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
    evaluate.mockReset();
    evaluate.mockResolvedValueOnce("mock-csrf-token");
    evaluate.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        ...rawLocation,
        LocationCode: String(1265 + i),
      })),
    );
    evaluate.mockResolvedValueOnce({
      _error: false,
      data: {
        Success: true,
        Errors: [],
        ResponseData: {
          Request: {
            YardCode: ["1265"],
            Filter: "",
            PageSize: 500,
            PageNumber: 1,
            FilterDeals: false,
          },
          Vehicles: [
            {
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
            },
          ],
        },
        Messages: [],
      },
    });

    const ingestedVins: string[] = [];
    const result = await Effect.runPromise(
      streamPypInventory({
        startPage: 0,
        maxPages: 1,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            ingestedVins.push(...vehicles.map((vehicle) => vehicle.vin));
          }),
      }).pipe(
        Effect.provideService(Config, {
          hyperbrowserApiKey: "mock-api-key",
          betterStackHeartbeatUrl: undefined,
        }),
        Effect.scoped,
      ),
    );

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        path: expect.stringContaining("&page=0&pageSize=500"),
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.cursor).toBe(1);
    expect(result.pagesProcessed).toBe(1);
    expect(result.count).toBe(1);
    expect(ingestedVins).toEqual(["2HGFC2F84LH554430"]);
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
