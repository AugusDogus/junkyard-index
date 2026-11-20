import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  isDurableSourceCursorTerminal,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
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
// Synthetic F150 donors so the page lists 83 of its 86 badged donors: still
// short, so closing confirms it, but above the badge coverage floor.
const paddingDonors = Array.from({ length: 80 }, (_, i) =>
  oemDonorExcerpt
    .replaceAll("10563", String(20000 + i))
    .replaceAll("1FTMF1KP0RKE76038", "1FTMF1KP0RK" + String(900000 + i)),
).join("");
const model = oemFixtureDocument(oemDonorExcerpt + otherDonors + paddingDonors);
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
    // F150 page, whose 83 cards differ from its 86 badge.
    expect(resumed.cursor.requests).toBe(6);
    expect(resumed.accounting).toEqual({
      recordsProcessed: 84,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 1,
    });
    expect(resumed.count).toBe(83);
    expect(batches).toHaveLength(1);
    const terminal = await Effect.runPromise(
      streamOemInventory({ ...opts, startCursor: resumed.cursor }),
    );
    expect(terminal.count).toBe(0);
    expect(batches).toHaveLength(1);
  });
  test("a finished cold crawl persists a terminal census cursor and a mid-crawl one is not terminal", async () => {
    const opts = options(() => undefined);
    let wire: string | undefined;
    let midWire: string | undefined;
    for (let chunk = 0; chunk < 10; chunk++) {
      const result = await Effect.runPromise(
        streamOemInventory({
          ...opts,
          maxPages: 3,
          startCursor:
            wire === undefined
              ? undefined
              : parseDurableSourceCursor("oem", wire),
        }),
      );
      wire = serializeDurableSourceCursor(result.cursor);
      midWire ??= wire;
      if (result.status === "complete") break;
    }
    if (wire === undefined || midWire === undefined)
      throw new Error("OEM crawl produced no cursor");
    const terminal = parseDurableSourceCursor("oem", wire);
    expect(serializeDurableSourceCursor(terminal)).toBe(wire);
    expect(terminal.state.phase).toBe("complete");
    const census =
      terminal.state.phase === "complete" ? terminal.state.census : undefined;
    expect(census?.models.length ?? 0).toBeGreaterThan(0);
    expect(isDurableSourceCursorTerminal("oem", wire)).toBe(true);
    expect(parseDurableSourceCursor("oem", midWire).state.phase).not.toBe(
      "complete",
    );
    expect(isDurableSourceCursorTerminal("oem", midWire)).toBe(false);
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
    // The F150 badge counts 86 donors; its model page lists 83 cards.
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
