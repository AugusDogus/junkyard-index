import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { SandwProviderError, readSandwPage } from "./sandw-client";
import { streamSandwInventory } from "./sandw-connector";
import { SandwCursor } from "./sandw-cursor";
import {
  parseSandwInventory,
  parseSandwOwner,
  parseSandwScope,
} from "./sandw-parser";
import {
  sandwSnapshot,
  transformSandwRecord,
  validateSandwSnapshot,
  type SandwCanonicalVehicle,
} from "./sandw-transform";
import {
  SANDW_API,
  SANDW_CATALOG,
  SANDW_OWNER,
  SANDW_YARD,
} from "./sandw-yard-metadata";

// Actual November 15 UTC native response bytes, including the unchanged closing
// report. Request metadata and public client traversal are in the lane evidence.
const fixture = z
  .object({
    owner: z.string(),
    scope: z.string(),
    opening: z.string(),
    closing: z.string(),
  })
  .strict()
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./sandw-test-fixtures/native.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
const native = () => parseSandwInventory(fixture.opening);
const first = () => {
  const row = native().vehicles[0];
  if (!row) throw new Error("Native fixture has no first donor");
  return row;
};
function reader(changeClosing?: (raw: string) => string) {
  let inventoryReads = 0;
  const calls: string[] = [];
  return {
    calls,
    readPage: (url: string) => {
      calls.push(url);
      if (url === SANDW_OWNER) return Effect.succeed(fixture.owner);
      if (url === SANDW_CATALOG) return Effect.succeed(fixture.scope);
      if (url === SANDW_API) {
        inventoryReads++;
        return Effect.succeed(
          inventoryReads === 1
            ? fixture.opening
            : (changeClosing?.(fixture.closing) ?? fixture.closing),
        );
      }
      return Effect.fail(
        new SandwProviderError(
          "saved reader",
          "Unpublished destination " + url,
        ),
      );
    },
  };
}

describe("S&W complete native report", () => {
  test("replays the whole native report and closes before emitting 624 GA donors", async () => {
    const input = reader(),
      batches: SandwCanonicalVehicle[][] = [];
    const result = await Effect.runPromise(
      streamSandwInventory({
        previousUniqueInventory: null,
        readPage: input.readPage,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches.push(vehicles);
          }),
      }),
    );
    expect(result.status).toBe("complete");
    expect(input.calls).toEqual([
      SANDW_OWNER,
      SANDW_CATALOG,
      SANDW_API,
      SANDW_API,
      SANDW_OWNER,
    ]);
    expect(result.accounting).toEqual({
      recordsProcessed: 624,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(result.count).toBe(624);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]).toMatchObject({
      source: "sandw",
      vin: "WBAUL7C54BVM78904",
      year: 2011,
      make: "BMW",
      model: "1 SERIES",
      stockNumber: "STK084213",
      row: "27",
      color: null,
      imageUrl: null,
      availableDate: "2026-10-31",
      stateAbbr: "GA",
      detailsUrl: SANDW_CATALOG,
      lat: SANDW_YARD.lat,
      lng: SANDW_YARD.lng,
    });
    expect(result.warnings).toEqual([
      expect.stringContaining(
        "marked stale; native lastSyncedAt=2026-11-02T12:02:06.000Z",
      ),
    ]);
    expect(result.observedVins).toEqual([]);
  });

  test("resumes one native GET per chunk without emitting partial census", async () => {
    const input = reader();
    let cursor = SandwCursor.initial(),
      emitted = 0;
    for (let chunk = 0; chunk < 5; chunk++) {
      const result = await Effect.runPromise(
        streamSandwInventory({
          startCursor: JSON.parse(JSON.stringify(cursor)),
          maxPages: 1,
          previousUniqueInventory: null,
          readPage: input.readPage,
          onBatch: (vehicles) =>
            Effect.sync(() => {
              emitted += vehicles.length;
            }),
        }),
      );
      expect(emitted).toBe(chunk === 4 ? 624 : 0);
      cursor = result.cursor;
    }
    const done = await Effect.runPromise(
      streamSandwInventory({
        startCursor: cursor,
        previousUniqueInventory: null,
        readPage: input.readPage,
        onBatch: () => Effect.die("Completed census must not reemit"),
      }),
    );
    expect(done.pagesProcessed).toBe(0);
    expect(input.calls).toHaveLength(5);
  });

  test("closing identity drift prevents every callback", async () => {
    const input = reader((raw) => {
      const report = parseSandwInventory(raw);
      report.vehicles = report.vehicles.slice(1);
      return JSON.stringify(report);
    });
    await expect(
      Effect.runPromise(
        streamSandwInventory({
          previousUniqueInventory: null,
          readPage: input.readPage,
          onBatch: () => Effect.die("No partial emission"),
          onYards: () => Effect.die("No partial yard emission"),
        }),
      ),
    ).rejects.toThrow("closing report changed");
  });

  test("optional closing changes become null without rejecting a donor", async () => {
    const input = reader((raw) => {
      const report = parseSandwInventory(raw);
      report.vehicles = report.vehicles.map((row, index) =>
        index === 0 ? { ...row, location: "Row 90" } : row,
      );
      return JSON.stringify(report);
    });
    let accepted: SandwCanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamSandwInventory({
        previousUniqueInventory: null,
        readPage: input.readPage,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            accepted = vehicles;
          }),
      }),
    );
    expect(result.count).toBe(624);
    expect(accepted[0]?.row).toBeNull();
  });

  test("awaiting_sync, unread pagination, truncation and owner drift fail closed", () => {
    expect(() =>
      parseSandwInventory(
        JSON.stringify({ ...native(), status: "awaiting_sync" }),
      ),
    ).toThrow();
    expect(() =>
      parseSandwInventory(
        JSON.stringify({ ...native(), next: "/api/inventory/vehicles?page=2" }),
      ),
    ).toThrow();
    expect(() => parseSandwInventory(fixture.opening.slice(0, -20))).toThrow();
    expect(() =>
      parseSandwOwner(
        fixture.owner.replaceAll("1826 Lithonia", "1827 Lithonia"),
      ),
    ).toThrow();
    expect(() =>
      parseSandwScope(
        fixture.scope.replace("daily CRUSH yard report", "parts warehouse"),
      ),
    ).toThrow();
    expect(() => parseSandwOwner(fixture.owner.slice(0, -30))).toThrow();
  });

  test("checkpoint alteration and fake phase progression are rejected", () => {
    const state = SandwCursor.initial();
    expect(() => SandwCursor.parse({ ...state, phase: "complete" })).toThrow(
      "checksum",
    );
    expect(() =>
      SandwCursor.parse({ ...state, ignoredNextPage: true }),
    ).toThrow();
    expect(() =>
      SandwCursor.parse({ ...state, scope: "0".repeat(64) }),
    ).toThrow();
  });
});

describe("S&W native identity and accounting", () => {
  test("uses supported older serials and retains optional null conventions", () => {
    const row = {
      ...first(),
      year: 1970,
      vin: "1234567890",
      vinLast6: "567890",
      stockNumber: undefined,
      location: "unknown",
      arrivalDate: "2026-02-30T00:00:00.000Z",
      imageUrl: "https://foreign.example/STK084213/1.jpg",
    };
    const result = transformSandwRecord(row);
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Supported older serial was rejected");
    expect(result.vehicle).toMatchObject({
      vin: "1234567890",
      stockNumber: null,
      row: null,
      imageUrl: null,
      availableDate: null,
    });
  });

  test("missing required fields and conflicting VIN suffixes are real rejects", () => {
    const report = native();
    report.vehicles = report.vehicles.map((row, index) =>
      index === 0 ? { ...row, model: null } : row,
    );
    const result = sandwSnapshot(report);
    expect(result.accounting.recordsRejected).toBe(1);
    expect(result.observedVins).toEqual(["WBAUL7C54BVM78904"]);
    expect(() => validateSandwSnapshot(result, null)).not.toThrow();
    expect(
      transformSandwRecord({ ...first(), vinLast6: "999999" }).status,
    ).toBe("rejected");
    expect(
      transformSandwRecord({ ...first(), year: 2011, vin: "1234567890" })
        .status,
    ).toBe("rejected");
  });

  test("benign duplicate metadata is merged but native VIN/YMM or stock conflicts abort", () => {
    const report = native();
    report.vehicles.push(
      { ...first(), color: "BLUE" },
      { ...first(), color: "RED" },
    );
    const result = sandwSnapshot(report);
    expect(result.vehicles).toHaveLength(624);
    expect(result.vehicles[0]?.color).toBeNull();
    expect(result.accounting.duplicateVehicles).toBe(2);
    expect(() => validateSandwSnapshot(result, null)).not.toThrow();
    expect(() =>
      sandwSnapshot({
        ...native(),
        vehicles: [...native().vehicles, { ...first(), make: "FORD" }],
      }),
    ).toThrow("conflicting native YMM");
    expect(() =>
      sandwSnapshot({
        ...native(),
        vehicles: [
          ...native().vehicles,
          { ...first(), vin: "1GCEK19R0WR154154", vinLast6: "154154" },
        ],
      }),
    ).toThrow();
  });

  test("enforces the census floor, existing rejection/duplicate limits and prior-count drift", () => {
    const complete = sandwSnapshot(native());
    expect(() => validateSandwSnapshot(complete, 1248)).not.toThrow();
    expect(() => validateSandwSnapshot(complete, 1249)).toThrow();
    expect(() =>
      validateSandwSnapshot(
        sandwSnapshot({
          ...native(),
          vehicles: native().vehicles.slice(0, 207),
        }),
        null,
      ),
    ).toThrow();
    const rejected = {
      ...native(),
      vehicles: native().vehicles.map((row, index) =>
        index < 63 ? { ...row, vin: null } : row,
      ),
    };
    expect(() =>
      validateSandwSnapshot(sandwSnapshot(rejected), null),
    ).toThrow();
    const duplicate = {
      ...native(),
      vehicles: [...native().vehicles, ...Array.from({ length: 209 }, first)],
    };
    expect(() =>
      validateSandwSnapshot(sandwSnapshot(duplicate), null),
    ).toThrow();
  });

  test("the HTTP reader rejects foreign destinations before fetching", async () => {
    let called = false;
    // Destination validation is inside the serialization gate, before fetch.
    await expect(
      Effect.runPromise(
        readSandwPage("https://foreign.example/", (request) => {
          called = true;
          return request;
        }),
      ),
    ).rejects.toThrow("outside the verified");
    expect(called).toBe(true);
  });

  test("an HTTP403 stops the reader after one request and cancels the unread body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    );
    try {
      await expect(
        Effect.runPromise(readSandwPage(SANDW_API, (request) => request)),
      ).rejects.toThrow("HTTP403");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(cancelled).toBe(true);
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        method: "GET",
        redirect: "manual",
      });
    } finally {
      fetch.mockRestore();
    }
  });

  test("HTML shells and partial-content inventory cannot become successful empty reports", async () => {
    const fetch = spyOn(globalThis, "fetch");
    try {
      for (const headers of [
        new Headers({ "Content-Type": "text/html" }),
        new Headers({
          "Content-Type": "application/json",
          "Content-Range": "bytes 0-10/1000",
        }),
      ]) {
        fetch.mockResolvedValueOnce(
          new Response("{}", { status: 200, headers }),
        );
        await expect(
          Effect.runPromise(readSandwPage(SANDW_API, (request) => request)),
        ).rejects.toThrow("Expected complete owned");
      }
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      fetch.mockRestore();
    }
  });
});
