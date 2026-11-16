import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import {
  IndianriverProviderError,
  readIndianriverPage,
} from "./indianriver-client";
import { streamIndianriverInventory } from "./indianriver-connector";
import {
  IndianriverCursor,
  indianriverRequiredReport,
} from "./indianriver-cursor";
import {
  indianriverHash,
  parseIndianriverOwner,
  parseIndianriverPage,
} from "./indianriver-parser";
import {
  indianriverSnapshot,
  transformIndianriverRecord,
  validateIndianriverSnapshot,
  type IndianriverCanonicalVehicle,
} from "./indianriver-transform";
import {
  INDIANRIVER_CATALOG,
  INDIANRIVER_OWNER,
  INDIANRIVER_YARD,
  indianriverPageUrl,
} from "./indianriver-yard-metadata";

// Eight actual dated native documents: owner, all three opening pages, all three
// closing pages and owner closure. Native HTTP metadata remains in lane evidence.
const fixture = z
  .array(z.string())
  .length(8)
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./indianriver-test-fixtures/native.json.gz",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
function raw(index: number): string {
  const value = fixture[index];
  if (value === undefined)
    throw new Error("Missing saved native document " + index);
  return value;
}
const pages = () =>
  [1, 2, 3].map((index, i) => parseIndianriverPage(raw(index), i));
const native = () => indianriverSnapshot(pages());
const first = () => {
  const row = pages()[0]?.records[0];
  if (!row) throw new Error("Missing first native donor");
  return row;
};
function reader(change?: (body: string, call: number) => string) {
  const calls: string[] = [];
  const urls = [
    INDIANRIVER_OWNER,
    indianriverPageUrl(0),
    indianriverPageUrl(1),
    indianriverPageUrl(2),
    indianriverPageUrl(0),
    indianriverPageUrl(1),
    indianriverPageUrl(2),
    INDIANRIVER_OWNER,
  ];
  return {
    calls,
    readPage: (url: string) => {
      const index = calls.length;
      calls.push(url);
      if (urls[index] !== url)
        return Effect.fail(
          new IndianriverProviderError(
            "saved reader",
            "Unexpected native traversal " + url,
          ),
        );
      return Effect.succeed(change?.(raw(index), index) ?? raw(index));
    },
  };
}

describe("Indian River complete native census", () => {
  test("replays all 1061 rows and eight controls before emitting 1049 FL donors", async () => {
    const input = reader(),
      batches: IndianriverCanonicalVehicle[][] = [];
    let yards = 0;
    const result = await Effect.runPromise(
      streamIndianriverInventory({
        previousUniqueInventory: null,
        readPage: input.readPage,
        onYards: (values) =>
          Effect.sync(() => {
            expect(input.calls).toHaveLength(8);
            yards += values.length;
          }),
        onBatch: (vehicles) =>
          Effect.sync(() => {
            expect(input.calls).toHaveLength(8);
            batches.push(vehicles);
          }),
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.pagesProcessed).toBe(8);
    expect(result.count).toBe(1049);
    expect(result.accounting).toEqual({
      recordsProcessed: 1061,
      recordsRejected: 7,
      recordsExcluded: 0,
      duplicateVehicles: 5,
    });
    expect(result.observedVins).toEqual(["1G1BU54E7LA129652", "CCT33AV154180"]);
    expect(yards).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]).toMatchObject({
      source: "indianriver",
      vin: "19UUA66216A027142",
      year: 2006,
      make: "Acura",
      model: "TL",
      stateAbbr: "FL",
      detailsUrl: INDIANRIVER_CATALOG,
      availableDate: "2025-03-11",
      row: null,
      stockNumber: null,
      imageUrl: null,
      lat: INDIANRIVER_YARD.lat,
      lng: INDIANRIVER_YARD.lng,
    });
    expect(
      batches[0]?.some((v) => v.vin === "40P0N10324" && v.year === 1940),
    ).toBe(true);
    expect(native().conflictingVins).toEqual([]);
  });

  test("resumes one GET per checkpoint without partial or repeated emission", async () => {
    const input = reader();
    let cursor = IndianriverCursor.initial(),
      emitted = 0;
    for (let i = 0; i < 8; i++) {
      const result = await Effect.runPromise(
        streamIndianriverInventory({
          previousUniqueInventory: null,
          startCursor: JSON.parse(JSON.stringify(cursor)),
          maxPages: 1,
          readPage: input.readPage,
          onBatch: (vehicles) =>
            Effect.sync(() => {
              emitted += vehicles.length;
            }),
        }),
      );
      expect(emitted).toBe(i === 7 ? 1049 : 0);
      cursor = result.cursor;
    }
    const result = await Effect.runPromise(
      streamIndianriverInventory({
        previousUniqueInventory: null,
        startCursor: cursor,
        readPage: input.readPage,
        onBatch: () => Effect.die("Completed census must not reemit"),
      }),
    );
    expect(result.pagesProcessed).toBe(0);
    expect(input.calls).toHaveLength(8);
  });

  test("closing required identity or ownership drift prevents every callback", async () => {
    for (const change of [
      (body: string, call: number) =>
        call === 4
          ? body.replaceAll("19UUA66216A027142", "19UUA66216A027143")
          : body,
      (body: string, call: number) =>
        call === 7 ? body.replaceAll("4600 45th St", "4601 45th St") : body,
    ]) {
      const input = reader(change);
      await expect(
        Effect.runPromise(
          streamIndianriverInventory({
            previousUniqueInventory: null,
            readPage: input.readPage,
            onBatch: () => Effect.die("No partial batch"),
            onYards: () => Effect.die("No partial yard"),
          }),
        ),
      ).rejects.toThrow();
    }
  });

  test("optional closing date drift becomes null", async () => {
    const input = reader((body, call) =>
      call === 4 ? body.replaceAll("03/11/2025", "03/12/2025") : body,
    );
    let accepted: IndianriverCanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamIndianriverInventory({
        previousUniqueInventory: null,
        readPage: input.readPage,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            accepted = vehicles;
          }),
      }),
    );
    expect(result.count).toBe(1049);
    expect(accepted[0]?.availableDate).toBeNull();
  });

  test("page ranges, scope, total, native IDs and truncated tables fail closed", () => {
    for (const body of [
      raw(1).replace("Showing 1 - 500 of 1061", "Showing 1 - 499 of 1061"),
      raw(1).replaceAll("inventory_category_id=", "inventory_category_id=4"),
      raw(1).replace("wpinventoryitem-6599 ", ""),
      raw(1).replace("wpinventoryitem-7996", "wpinventoryitem-6599"),
      raw(1).replace("</tbody>", ""),
      raw(1).replace(
        "</body>",
        '<button class="load-more">Show more</button></body>',
      ),
      raw(1).slice(0, -30),
    ])
      expect(() => parseIndianriverPage(body, 0)).toThrow();
    expect(() => parseIndianriverPage(raw(2), 0)).toThrow("range");
    expect(() => indianriverSnapshot(pages().slice(0, 2))).toThrow(
      "incomplete",
    );
    const changed = pages();
    const page = changed[1];
    if (!page) throw new Error("Missing second page");
    page.total++;
    expect(() => indianriverSnapshot(changed)).toThrow("inconsistent");
  });

  test("checkpoint checksum, scope and exact page prefix are checked before HTTP", () => {
    const cursor = IndianriverCursor.initial();
    expect(() =>
      IndianriverCursor.parse({ ...cursor, phase: "complete" }),
    ).toThrow("checksum");
    expect(() =>
      IndianriverCursor.parse({ ...cursor, ignoredNextPage: true }),
    ).toThrow();
    expect(() =>
      IndianriverCursor.parse({ ...cursor, scope: "0".repeat(64) }),
    ).toThrow();
    expect(() =>
      IndianriverCursor.checkpoint({
        source: cursor.source,
        version: cursor.version,
        scope: cursor.scope,
        ownerHash: parseIndianriverOwner(raw(0)),
        phase: "opening",
        opening: pages().slice(1, 2),
      }),
    ).toThrow("prefix");
    expect(indianriverHash(indianriverRequiredReport(pages()))).toBe(
      indianriverHash(
        indianriverRequiredReport(
          [4, 5, 6].map((index, i) => parseIndianriverPage(raw(index), i)),
        ),
      ),
    );
  });
});

describe("Indian River real identity and accounting", () => {
  test("preserves real rejects, lower-case VIN normalization and older serials", () => {
    const snapshot = native();
    expect(snapshot.rejected.map((v) => v.id)).toEqual([
      "6550",
      "8333",
      "7398",
      "7817",
      "6749",
      "8602",
      "8394",
    ]);
    expect(snapshot.vehicles.some((v) => v.vin === "1FTYR44U96PA66138")).toBe(
      true,
    );
    expect(snapshot.vehicles.some((v) => v.vin === "CCT33AV154180")).toBe(
      false,
    );
    const result = transformIndianriverRecord({
      ...first(),
      year: "1970",
      vin: "1234567890",
      arrivalDate: "02/30/2026",
      reference: "",
    });
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Supported serial rejected");
    expect(result.vehicle.availableDate).toBeNull();
    expect(result.vehicle.stockNumber).toBeNull();
  });

  test("connected conflicting VIN/YMM observations are quarantined before display normalization", () => {
    const values = pages(),
      page = values[0];
    if (!page) throw new Error("Missing page");
    const original = first();
    page.records = page.records.map((row, i) =>
      i === 1
        ? { ...row, vin: original.vin, make: "ACURA", model: "TLX" }
        : row,
    );
    const snapshot = indianriverSnapshot(values);
    expect(snapshot.conflictingVins).toContain(original.vin);
    expect(snapshot.observedVins).toContain(original.vin);
    expect(snapshot.vehicles.some((v) => v.vin === original.vin)).toBe(false);
    expect(snapshot.accounting.recordsRejected).toBe(9);
  });

  test("benign duplicates reconcile and conflicting optional dates merge to null", () => {
    const snapshot = native();
    expect(
      snapshot.vehicles.find((v) => v.vin === "1N6AD07UX6C409578")
        ?.availableDate,
    ).toBeNull();
    expect(snapshot.accounting.recordsProcessed).toBe(
      snapshot.vehicles.length +
        snapshot.accounting.recordsRejected +
        snapshot.accounting.duplicateVehicles,
    );
    validateIndianriverSnapshot(snapshot, 1049);
    expect(() => validateIndianriverSnapshot(snapshot, 2100)).toThrow("50%");
    expect(() => validateIndianriverSnapshot(snapshot, -1)).toThrow(
      "nonnegative",
    );
    expect(() =>
      validateIndianriverSnapshot(
        { ...snapshot, vehicles: snapshot.vehicles.slice(0, 348) },
        null,
      ),
    ).toThrow("349-donor");
    expect(() =>
      validateIndianriverSnapshot(
        {
          ...snapshot,
          accounting: {
            ...snapshot.accounting,
            recordsRejected: 500,
            recordsProcessed: 1554,
          },
        },
        null,
      ),
    ).toThrow("10%");
    expect(() =>
      validateIndianriverSnapshot(
        {
          ...snapshot,
          accounting: {
            ...snapshot.accounting,
            duplicateVehicles: 600,
            recordsProcessed: 1656,
          },
        },
        null,
      ),
    ).toThrow("25%");
  });
});

describe("Indian River HTTP boundary", () => {
  test("rejects foreign/filter destinations before fetch", async () => {
    const fetch = spyOn(globalThis, "fetch");
    try {
      await expect(
        Effect.runPromise(
          readIndianriverPage(
            INDIANRIVER_CATALOG + "?inventory_category_id=4",
            (effect) => effect,
          ),
        ),
      ).rejects.toThrow("destination");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  test("denied, redirect, partial and wrong-content responses are not retried", async () => {
    for (const response of [
      new Response("denied", { status: 403 }),
      new Response("", {
        status: 301,
        headers: { Location: "https://foreign.example" },
      }),
      new Response("partial", { status: 206 }),
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
      new Response("partial", {
        headers: {
          "Content-Type": "text/html",
          "Content-Range": "bytes 0-6/99",
        },
      }),
    ]) {
      const fetch = spyOn(globalThis, "fetch").mockResolvedValue(response);
      try {
        await expect(
          Effect.runPromise(
            readIndianriverPage(INDIANRIVER_CATALOG, (effect) => effect),
          ),
        ).rejects.toThrow("HTTP");
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        fetch.mockRestore();
      }
    }
  });
  test("reads complete bounded HTML with manual redirect handling", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(raw(3), {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      }),
    );
    try {
      expect(
        await Effect.runPromise(
          readIndianriverPage(indianriverPageUrl(2), (effect) => effect),
        ),
      ).toBe(raw(3));
      expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    } finally {
      fetch.mockRestore();
    }
  });
});
