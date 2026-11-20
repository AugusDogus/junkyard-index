import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamOemInventory } from "./oem-connector";
import { OemCursor, OemCursorSchema } from "./oem-cursor";
import { OEM_ARRIVALS, OEM_MAKES } from "./oem-html";
import {
  oemArrivalFixture,
  oemDonorExcerpt,
  oemDonorFixture,
  oemF150,
  oemFord,
  oemFixtureDocument,
  oemMakeFixture,
  oemModelFixture,
} from "./oem-test-fixtures";

// Two further native F150 donors captured with 10563 on November 15, 2026.
const otherDonors =
  oemDonorExcerpt
    .replaceAll("10563", "10834")
    .replaceAll("1FTMF1KP0RKE76038", "1FTMF1KP7RKF17085")
    .replace("23000", "11000") +
  oemDonorExcerpt
    .replaceAll("10563", "10804")
    .replaceAll("2024", "2023")
    .replaceAll("1FTMF1KP0RKE76038", "1FTFW1ED4PFA49879")
    .replace("23000", "78000");
const model = oemFixtureDocument(oemDonorExcerpt + otherDonors);
const location = {
  code: "oem-bluffton",
  name: "OEM Auto Recyclers",
  city: "Bluffton",
  lat: 40.848554,
  lng: -83.8706706,
};
const responses = new Map([
  [OEM_ARRIVALS, oemArrivalFixture],
  [OEM_MAKES, oemMakeFixture],
  [oemFord.url, oemModelFixture],
  [oemF150.url, model],
]);
const options = (onBatch: (vins: string[]) => void) => ({
  location,
  minimumUniqueInventory: 3,
  previousUniqueInventory: null,
  readPage: (url: string) =>
    Effect.sync(() => {
      const raw = responses.get(url);
      if (!raw) throw new Error("Unexpected fixture request " + url);
      return raw;
    }),
  onBatch: (vehicles: { vin: string }[]) =>
    Effect.sync(() => onBatch(vehicles.map((v) => v.vin))),
});
describe("OEM resumable native traversal", () => {
  test("pauses and resumes without emitting an incomplete union", async () => {
    const batches: string[][] = [];
    const opts = options((vins) => batches.push(vins));
    const first = await Effect.runPromise(
      streamOemInventory({ ...opts, maxPages: 3 }),
    );
    expect(first.status).toBe("paused");
    expect(first.count).toBe(0);
    expect(batches).toEqual([]);
    const resumed = await Effect.runPromise(
      streamOemInventory({
        ...opts,
        maxPages: 8,
        startCursor: JSON.parse(JSON.stringify(first.cursor)),
      }),
    );
    expect(resumed.status).toBe("complete");
    // Opening arrivals, makes, one menu and one model; closing makes and the
    // F150 page, whose three cards differ from its 86 badge.
    expect(resumed.cursor.requests).toBe(6);
    expect(resumed.accounting).toEqual({
      recordsProcessed: 4,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 1,
    });
    expect(resumed.count).toBe(3);
    expect(batches).toHaveLength(1);
    const terminal = await Effect.runPromise(
      streamOemInventory({ ...opts, startCursor: resumed.cursor }),
    );
    expect(terminal.count).toBe(0);
    expect(batches).toHaveLength(1);
  });
  test("rejects a mutated checkpoint before fetching", async () => {
    let requests = 0;
    const mutated = { ...OemCursor.initial(), requests: 1 };
    expect(OemCursorSchema.safeParse(mutated).success).toBe(false);
    const exit = await Effect.runPromiseExit(
      streamOemInventory({
        ...options(() => undefined),
        startCursor: mutated,
        readPage: () =>
          Effect.sync(() => {
            requests++;
            return oemDonorFixture;
          }),
      }),
    );
    expect(exit._tag).toBe("Failure");
    expect(requests).toBe(0);
  });
  test("closing make directory drift blocks the complete callback", async () => {
    let requests = 0,
      batches = 0;
    const exit = await Effect.runPromiseExit(
      streamOemInventory({
        ...options(() => {
          batches++;
        }),
        maxPages: 8,
        readPage: (url) =>
          Effect.sync(() => {
            requests++;
            const raw = responses.get(url);
            if (!raw) throw new Error("Unexpected fixture URL");
            return requests === 5
              ? raw.replace(">483</span>", ">484</span>")
              : raw;
          }),
      }),
    );
    expect(exit._tag).toBe("Failure");
    expect(requests).toBe(5);
    expect(batches).toBe(0);
  });
  test("closing confirms a model read with fewer cards than its badge", async () => {
    // The F150 badge counts 86 donors; its model page lists three cards.
    const urls: string[] = [];
    const opts = options(() => undefined);
    const result = await Effect.runPromise(
      streamOemInventory({
        ...opts,
        maxPages: 8,
        readPage: (url) => {
          urls.push(url);
          return opts.readPage(url);
        },
      }),
    );
    expect(result.status).toBe("complete");
    expect(urls).toEqual([
      OEM_ARRIVALS,
      OEM_MAKES,
      oemFord.url,
      oemF150.url,
      OEM_MAKES,
      oemF150.url,
    ]);
    expect(result.cursor.requests).toBe(6);

    // A short page that does not repeat at closing is never accepted.
    let batches = 0,
      reads = 0;
    await expect(
      Effect.runPromise(
        streamOemInventory({
          ...options(() => {
            batches++;
          }),
          maxPages: 8,
          readPage: (url) =>
            url === oemF150.url && reads++ === 1
              ? Effect.succeed(oemDonorFixture)
              : opts.readPage(url),
        }),
      ),
    ).rejects.toThrow("Closing OEM model FORD F150 PICKUP cards changed");
    expect(reads).toBe(2);
    expect(batches).toBe(0);
  });
  test("model page foreign supplier evidence cannot be hidden by unchanged VINs", async () => {
    let requests = 0,
      batches = 0;
    const exit = await Effect.runPromiseExit(
      streamOemInventory({
        ...options(() => {
          batches++;
        }),
        maxPages: 8,
        readPage: (url) =>
          Effect.sync(() => {
            requests++;
            const raw = responses.get(url);
            if (!raw) throw new Error("Unexpected fixture URL");
            return url === oemF150.url
              ? raw.replaceAll("/oh40/images/", "/mi07/images/")
              : raw;
          }),
      }),
    );
    expect(exit._tag).toBe("Failure");
    expect(batches).toBe(0);
  });
  test("arrival and model photo disagreement becomes null without rejecting valid identities", async () => {
    let requests = 0;
    const images: (string | null)[] = [];
    const opts = options(() => undefined);
    const result = await Effect.runPromise(
      streamOemInventory({
        ...opts,
        maxPages: 8,
        readPage: (url) =>
          Effect.sync(() => {
            requests++;
            const raw = responses.get(url);
            if (!raw) throw new Error("Unexpected fixture URL");
            return url === oemF150.url
              ? raw.replaceAll("10563_0.jpg", "10563_1.jpg")
              : raw;
          }),
        onBatch: (vehicles) =>
          Effect.sync(() => {
            images.push(
              ...vehicles
                .filter((v) => v.stockNumber === "10563")
                .map((v) => v.imageUrl),
            );
          }),
      }),
    );
    expect(result.status).toBe("complete");
    expect(images).toEqual([null]);
  });
});
