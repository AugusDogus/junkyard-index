import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamChasencarsInventory } from "./chasencars-connector";
import {
  ChasencarsCursor,
  CHASENCARS_MAX_CURSOR_BYTES,
} from "./chasencars-cursor";
import { chasencarsReader } from "./chasencars-test-fixtures";
import type { ChasencarsVehicle } from "./chasencars-snapshot";
import {
  CHASENCARS_CATALOG,
  CHASENCARS_OWNER,
  CHASENCARS_YARD_URL,
} from "./chasencars-yard-metadata";

test("Chase N Cars six serialized one-GET chunks stage only after genuine closing and reentry is inert", async () => {
  const reader = chasencarsReader(),
    batches: ChasencarsVehicle[][] = [];
  let cursor = ChasencarsCursor.initial(null),
    yards = 0,
    maxWire = 0;
  for (let count = 0; count < 6; count++) {
    const result = await Effect.runPromise(
      streamChasencarsInventory({
        previousAcceptedCount: null,
        startCursor: cursor,
        maxPages: 1,
        readPage: reader.readPage,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches.push(vehicles);
          }),
        onYards: () =>
          Effect.sync(() => {
            yards++;
          }),
      }),
    );
    const wire = ChasencarsCursor.serialize(result.cursor, null);
    maxWire = Math.max(maxWire, Buffer.byteLength(wire));
    cursor = ChasencarsCursor.fromWire(wire, null);
    expect(result.pagesProcessed).toBe(1);
    if (count < 5) {
      expect(result.status).toBe("paused");
      expect(result.count).toBe(0);
      expect(result.observedVins).toEqual([]);
      expect(result.accounting.recordsProcessed).toBe(0);
      expect(batches).toEqual([]);
      expect(yards).toBe(0);
    } else {
      expect(result.status).toBe("complete");
      expect(result.count).toBe(661);
      expect(result.accounting.recordsRejected).toBe(19);
    }
  }
  expect(reader.calls).toEqual([
    CHASENCARS_OWNER,
    CHASENCARS_YARD_URL,
    CHASENCARS_CATALOG,
    CHASENCARS_CATALOG,
    CHASENCARS_YARD_URL,
    CHASENCARS_OWNER,
  ]);
  expect(cursor.phase).toBe("complete");
  expect(cursor.requests).toBe(6);
  expect(cursor.bytes).toBe(1_903_014);
  expect(maxWire).toBeLessThan(CHASENCARS_MAX_CURSOR_BYTES);
  expect(batches).toHaveLength(1);
  expect(yards).toBe(1);
  const reentry = await Effect.runPromise(
    streamChasencarsInventory({
      previousAcceptedCount: null,
      startCursor: cursor,
      readPage: reader.readPage,
      onBatch: () => Effect.fail("No repeated staging"),
    }),
  );
  expect(reentry.pagesProcessed).toBe(0);
  expect(reentry.count).toBe(0);
  expect(reader.calls).toHaveLength(6);
});
test("Chase N Cars closing drift and native ownership changes never stage", async () => {
  for (const mutate of [
    (raw: string, call: number) =>
      call === 4 ? raw.replace("1FTSS34P26DA41405", "1FTSS34P26DA41406") : raw,
    (raw: string, call: number) =>
      call === 4 ? raw.replace("STK002848", "STK099999") : raw,
    (raw: string, call: number) =>
      call === 5 ? raw.replaceAll("6471 State", "9999 State") : raw,
    (raw: string, call: number) =>
      call === 6
        ? raw.replace(
            "Simply bring your tools, remove the part yourself",
            "Foreign supplier network",
          )
        : raw,
  ]) {
    const reader = chasencarsReader((raw, _url, call) => mutate(raw, call));
    let staged = 0;
    const result = await Effect.runPromise(
      Effect.either(
        streamChasencarsInventory({
          previousAcceptedCount: null,
          readPage: reader.readPage,
          onBatch: () =>
            Effect.sync(() => {
              staged++;
            }),
          onYards: () =>
            Effect.sync(() => {
              staged++;
            }),
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(staged).toBe(0);
  }
});
test("Chase N Cars callbacks cannot produce a completed checkpoint on failure", async () => {
  for (const failYard of [false, true]) {
    const reader = chasencarsReader();
    let batches = 0;
    const result = await Effect.runPromise(
      Effect.either(
        streamChasencarsInventory({
          previousAcceptedCount: null,
          readPage: reader.readPage,
          onYards: () =>
            failYard ? Effect.fail("yard staging failure") : Effect.void,
          onBatch: () => {
            batches++;
            return Effect.fail("vehicle staging failure");
          },
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(batches).toBe(failYard ? 0 : 1);
  }
});
test("Chase N Cars retains a valid rejected identity at terminal emission across resume", async () => {
  const reader = chasencarsReader((raw, url) =>
    url === CHASENCARS_CATALOG ? raw.replace(">FORD</td>", "></td>") : raw,
  );
  let cursor = ChasencarsCursor.initial(null),
    staged: ChasencarsVehicle[] = [];
  for (let index = 0; index < 6; index++) {
    const result = await Effect.runPromise(
      streamChasencarsInventory({
        previousAcceptedCount: null,
        startCursor: cursor,
        maxPages: 1,
        readPage: reader.readPage,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            staged = vehicles;
          }),
      }),
    );
    cursor = ChasencarsCursor.fromWire(
      ChasencarsCursor.serialize(result.cursor, null),
      null,
    );
    if (index === 5) {
      expect(result.count).toBe(660);
      expect(result.accounting.recordsRejected).toBe(20);
      expect(result.observedVins).toEqual(["1FTSS34P26DA41405"]);
    }
  }
  expect(staged.some((vehicle) => vehicle.vin === "1FTSS34P26DA41405")).toBe(
    false,
  );
});
test("Chase N Cars cumulative prior drift cannot be bypassed by single-GET chunks", async () => {
  const reader = chasencarsReader();
  let cursor = ChasencarsCursor.initial(1324),
    staged = 0;
  for (let index = 0; index < 5; index++) {
    const result = await Effect.runPromise(
      streamChasencarsInventory({
        previousAcceptedCount: 1324,
        startCursor: cursor,
        maxPages: 1,
        readPage: reader.readPage,
        onBatch: () =>
          Effect.sync(() => {
            staged++;
          }),
      }),
    );
    cursor = ChasencarsCursor.fromWire(
      ChasencarsCursor.serialize(result.cursor, 1324),
      1324,
    );
  }
  const result = await Effect.runPromise(
    Effect.either(
      streamChasencarsInventory({
        previousAcceptedCount: 1324,
        startCursor: cursor,
        maxPages: 1,
        readPage: reader.readPage,
        onBatch: () =>
          Effect.sync(() => {
            staged++;
          }),
      }),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(staged).toBe(0);
  expect(cursor.phase).toBe("closing-owner");
});
test("Chase N Cars checksum, phase/accounting, wire bounds and previous-count binding reject bad resume before HTTP", async () => {
  const initial = ChasencarsCursor.initial(null);
  expect(() =>
    ChasencarsCursor.fromWire(
      " ".repeat(CHASENCARS_MAX_CURSOR_BYTES + 1),
      null,
    ),
  ).toThrow();
  expect(() =>
    ChasencarsCursor.parse({ ...initial, bytes: 10 }, null),
  ).toThrow();
  expect(() =>
    ChasencarsCursor.parse({ ...initial, phase: "ready" }, null),
  ).toThrow();
  expect(() => ChasencarsCursor.parse(initial, 10)).toThrow();
  const reader = chasencarsReader();
  for (const budget of [0, 9, NaN]) {
    const result = await Effect.runPromise(
      Effect.either(
        streamChasencarsInventory({
          previousAcceptedCount: null,
          maxPages: budget,
          readPage: reader.readPage,
          onBatch: () => Effect.void,
        }),
      ),
    );
    expect(result._tag).toBe("Left");
  }
  expect(reader.calls).toEqual([]);
});
