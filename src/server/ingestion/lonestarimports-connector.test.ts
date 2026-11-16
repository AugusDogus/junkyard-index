import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  LonestarimportsCursor,
  lonestarimportsAdvance,
  lonestarimportsNextUrl,
} from "./lonestarimports-cursor";
import { streamLonestarimportsInventory } from "./lonestarimports-connector";
import { lonestarimportsNative } from "./lonestarimports-test-fixtures";
import { LonestarimportsProviderError } from "./lonestarimports-client";
import { parseLonestarimportsPage } from "./lonestarimports-parser";
import { lonestarimportsSnapshot } from "./lonestarimports-snapshot";

const bodies = [
  ...lonestarimportsNative.openingDocuments,
  ...lonestarimportsNative.openingPages,
  ...lonestarimportsNative.closingPages,
  ...[...lonestarimportsNative.closingDocuments].reverse(),
];
const rows = lonestarimportsNative.openingPages.flatMap(
  (raw) => parseLonestarimportsPage(raw).data,
);
const first = rows[0];
const older = rows.find((r) => r.VIN === "10801412029308");
if (!first || !older)
  throw new Error("Actual Lonestar native test fixtures are incomplete");
test("one-GET durable chunks serialize every complete opening/closing step and emit only at terminal", async () => {
  let cursor = LonestarimportsCursor.initial(null),
    reads = 0,
    batches = 0,
    yards = 0,
    maxWireBytes = 0;
  while (cursor.phase !== "complete") {
    const expectedUrl = lonestarimportsNextUrl(cursor);
    const result = await Effect.runPromise(
      streamLonestarimportsInventory({
        previousAcceptedCount: null,
        startCursor: cursor,
        maxPages: 1,
        readPage: (url) =>
          Effect.sync(() => {
            expect(url).toBe(expectedUrl);
            const body = bodies[reads++];
            if (!body) throw new Error("Unexpected source request");
            return body;
          }),
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches++;
            expect(vehicles).toHaveLength(2531);
          }),
        onYards: (items) =>
          Effect.sync(() => {
            yards++;
            expect(items[0]?.state).toBe("TX");
          }),
      }),
    );
    expect(result.pagesProcessed).toBe(1);
    if (result.status === "paused") {
      expect([
        result.count,
        batches,
        yards,
        result.observedVins.length,
        result.rejections.length,
      ]).toEqual([0, 0, 0, 0, 0]);
      expect(Object.values(result.accounting)).toEqual([0, 0, 0, 0]);
    } else {
      expect(result.count).toBe(2531);
      expect(result.accounting).toEqual({
        recordsProcessed: 2560,
        recordsRejected: 9,
        recordsExcluded: 20,
        duplicateVehicles: 0,
      });
      expect(result.observedVins).toEqual(["1GAHG39R6Y1138058"]);
      expect(result.rejections).toHaveLength(9);
    }
    const wire = LonestarimportsCursor.serialize(result.cursor, null);
    maxWireBytes = Math.max(maxWireBytes, Buffer.byteLength(wire));
    cursor = LonestarimportsCursor.fromWire(wire, null);
  }
  expect([reads, batches, yards]).toEqual([264, 1, 1]);
  expect(maxWireBytes).toBeLessThan(16 * 1024 * 1024);
  const terminal = await Effect.runPromise(
    streamLonestarimportsInventory({
      previousAcceptedCount: null,
      startCursor: cursor,
      readPage: () => Effect.die("Completed reentry must not read"),
      onBatch: () => Effect.die("Completed reentry must not emit"),
    }),
  );
  expect(terminal.status).toBe("complete");
  expect(terminal.pagesProcessed).toBe(0);
}, 30_000);
test("actual closing drift aborts without any staging callback", async () => {
  let reads = 0,
    batches = 0,
    cursor = LonestarimportsCursor.initial(null);
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      while (cursor.phase !== "complete") {
        const result = yield* streamLonestarimportsInventory({
          previousAcceptedCount: null,
          startCursor: cursor,
          readPage: () =>
            Effect.sync(() => {
              const raw = bodies[reads++];
              if (!raw) throw new Error("Unexpected request");
              if (reads === 133) {
                const page = parseLonestarimportsPage(raw);
                return JSON.stringify({
                  ...page,
                  data: page.data.map((r, i) =>
                    i ? r : { ...r, Description: "synthetic test drift" },
                  ),
                });
              }
              return raw;
            }),
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
          onYards: () => Effect.die("Premature yard staging"),
        });
        cursor = result.cursor;
      }
    }),
  );
  expect(exit._tag).toBe("Failure");
  expect([reads, batches]).toEqual([133, 0]);
});
test("cursor rejects tampering, wrong prior-count binding, oversized wire and early completion", () => {
  const initial = LonestarimportsCursor.initial(null);
  expect(() => LonestarimportsCursor.parse({ ...initial, bytes: 1 })).toThrow();
  expect(() =>
    LonestarimportsCursor.fromWire(
      LonestarimportsCursor.serialize(initial),
      5000,
    ),
  ).toThrow();
  expect(() =>
    LonestarimportsCursor.fromWire(" ".repeat(16 * 1024 * 1024 + 1)),
  ).toThrow("16 MiB");
  expect(() => LonestarimportsCursor.complete(initial)).toThrow();
  const next = lonestarimportsAdvance(
    initial,
    lonestarimportsNative.openingDocuments[0] ?? "",
  );
  expect(next.phase).toBe("opening-documents");
  expect(next.requests).toBe(1);
});
test("cumulative source floor, active rejection, duplicate and prior drift guards remain enforced", () => {
  expect(lonestarimportsSnapshot(rows.slice(0, 100), null).errors).toContain(
    "Lonestar accepted inventory is below fixed source floor843",
  );
  const rejected = lonestarimportsSnapshot(
    rows.map((r, i) => (i < 300 ? { ...r, Manufacturer: null } : r)),
    null,
  );
  expect(rejected.errors).toContain(
    "Lonestar active rejection ratio exceeds10%",
  );
  expect(rejected.observedVins).toContain(first.VIN ?? "");
  expect(
    lonestarimportsSnapshot(
      [...rows, ...Array.from({ length: 1000 }, () => first)],
      null,
    ).errors,
  ).toContain("Lonestar active duplicate ratio exceeds25%");
  expect(lonestarimportsSnapshot(rows, 5064).errors).toContain(
    "Lonestar prior accepted inventory drift exceeds50%",
  );
  expect(lonestarimportsSnapshot(rows, 5063).errors).toEqual([]);
});
test("rejected and conflicting modern/older identities remain protected independently of required metadata", () => {
  const rejected = lonestarimportsSnapshot(
    [
      { ...first, Yr: null },
      { ...older, Manufacturer: null },
    ],
    null,
  );
  expect(rejected.observedVins).toEqual([first.VIN ?? "", older.VIN ?? ""]);
  const conflict = lonestarimportsSnapshot(
    [
      first,
      { ...first, ModelLong: "synthetic model conflict" },
      older,
      { ...older, Stock: "LS99999" },
    ],
    null,
  );
  expect(conflict.vehicles).toEqual([]);
  expect(conflict.rejected).toHaveLength(4);
  expect(conflict.observedVins).toEqual([first.VIN ?? "", older.VIN ?? ""]);
});
test("native foreign stock or image joins abort instead of dropping ownership evidence", () => {
  expect(
    lonestarimportsSnapshot([{ ...first, Stock: "FOREIGN1" }], null).errors,
  ).toContain(
    "Lonestar native own-stock namespace changed; review ownership before staging",
  );
  expect(
    lonestarimportsSnapshot(
      [{ ...first, PrimaryImageId: `${older.GUID}||1` }],
      null,
    ).errors,
  ).toContain(
    "Lonestar native image points to a different donor GUID; do not discard ownership evidence",
  );
});
test("invalid options and resolved source failures never silently retry", async () => {
  let reads = 0;
  const options = {
    previousAcceptedCount: null,
    readPage: () => {
      reads++;
      return Effect.fail(
        new LonestarimportsProviderError("synthetic denial", "HTTP403"),
      );
    },
    onBatch: () => Effect.void,
  };
  expect(
    (
      await Effect.runPromiseExit(
        streamLonestarimportsInventory({ ...options, maxPages: 9 }),
      )
    )._tag,
  ).toBe("Failure");
  expect(reads).toBe(0);
  expect(
    (await Effect.runPromiseExit(streamLonestarimportsInventory(options)))._tag,
  ).toBe("Failure");
  expect(reads).toBe(1);
});
