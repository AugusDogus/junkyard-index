import { describe, expect, test, spyOn } from "bun:test";
import { Effect } from "effect";
import {
  JimsimportProviderError,
  readJimsimportPage,
} from "./jimsimport-client";
import { streamJimsimportInventory } from "./jimsimport-connector";
import { JimsimportCursor } from "./jimsimport-cursor";
import { jimsimportHash } from "./jimsimport-parser";
import {
  jimsimportFixture,
  jimsimportOpeningFixture,
} from "./jimsimport-test-fixtures";
import {
  jimsimportSnapshot,
  validateJimsimportSnapshot,
  type JimsimportVehicle,
} from "./jimsimport-transform";
import {
  JIMSIMPORT_CATALOG,
  JIMSIMPORT_OWNER,
  JIMSIMPORT_YARD,
} from "./jimsimport-yard-metadata";

function closingState() {
  const { makes, menus, pages } = jimsimportOpeningFixture(),
    initial = JimsimportCursor.initial();
  return {
    source: initial.source,
    version: initial.version,
    scope: initial.scope,
    requests: 369,
    bytes: 50 * 1024 * 1024,
    ownerHash: jimsimportHash(JIMSIMPORT_YARD),
    makes,
    menus,
    opening: pages,
  };
}
describe("Jim's Import complete census guards", () => {
  test("all 4016 actual opening rows reconcile with all required rejects and connected conflicts", () => {
    const { menus, pages } = jimsimportOpeningFixture(),
      snapshot = jimsimportSnapshot(menus, pages);
    expect(snapshot.vehicles).toHaveLength(3649);
    expect(snapshot.observedVins).toHaveLength(3655);
    expect(
      snapshot.vehicles.find((vehicle) => vehicle.vin === "11612012020869"),
    ).toMatchObject({ year: 1980, make: "Mercedes-Benz", model: "300D" });
    expect(snapshot.accounting).toEqual({
      recordsProcessed: 4016,
      recordsRejected: 367,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(snapshot.conflicts).toHaveLength(6);
    expect(snapshot.vehicles.some((v) => v.vin === "WBANV13598C150569")).toBe(
      false,
    );
    expect(() => validateJimsimportSnapshot(snapshot)).not.toThrow();
    expect(() => validateJimsimportSnapshot(snapshot, 7300)).toThrow(
      "previous-count",
    );
    expect(() => jimsimportSnapshot(menus, pages.slice(1))).toThrow(
      "complete ordered",
    );
  });
  test("rejection and duplicate ceilings remain mandatory even when raw counts reconcile", () => {
    const { menus, pages } = jimsimportOpeningFixture(),
      snapshot = jimsimportSnapshot(menus, pages);
    expect(() =>
      validateJimsimportSnapshot({
        ...snapshot,
        accounting: {
          ...snapshot.accounting,
          recordsProcessed: 4100,
          recordsRejected: 451,
        },
      }),
    ).toThrow("rejection");
    expect(() =>
      validateJimsimportSnapshot({
        ...snapshot,
        accounting: {
          recordsProcessed: 6000,
          recordsRejected: 367,
          recordsExcluded: 0,
          duplicateVehicles: 1984,
        },
      }),
    ).toThrow("duplicate");
    expect(() =>
      validateJimsimportSnapshot({
        ...snapshot,
        accounting: { ...snapshot.accounting, recordsExcluded: 1 },
      }),
    ).toThrow("reconciliation");
  });
  test("bounded resume emits nothing before the closing frontier", async () => {
    const calls: string[] = [],
      batches: JimsimportVehicle[][] = [];
    const readPage = (url: string) => {
      calls.push(url);
      return url === JIMSIMPORT_OWNER
        ? Effect.succeed(jimsimportFixture("owner").body)
        : url === JIMSIMPORT_CATALOG
          ? Effect.succeed(jimsimportFixture("catalog").body)
          : url === "https://jimsimport.com/used-parts/ACURA"
            ? Effect.succeed(jimsimportFixture("acura").body)
            : Effect.fail(new JimsimportProviderError("test route", url));
    };
    const onBatch = (batch: JimsimportVehicle[]) =>
      Effect.sync(() => {
        batches.push(batch);
      });
    const first = await Effect.runPromise(
      streamJimsimportInventory({
        previousUniqueInventory: null,
        maxPages: 2,
        readPage,
        onBatch,
      }),
    );
    expect(first.status).toBe("paused");
    expect(first.cursor.phase).toBe("models");
    expect(batches).toEqual([]);
    const second = await Effect.runPromise(
      streamJimsimportInventory({
        previousUniqueInventory: null,
        maxPages: 1,
        startCursor: JSON.parse(JSON.stringify(first.cursor)),
        readPage,
        onBatch,
      }),
    );
    if (second.cursor.phase !== "models")
      throw new Error("Wrong resumed phase");
    expect(second.cursor.menus).toHaveLength(1);
    expect(second.cursor.menus[0]?.models).toHaveLength(12);
    expect(calls).toHaveLength(3);
    expect(batches).toEqual([]);
    await expect(
      Effect.runPromise(
        streamJimsimportInventory({
          previousUniqueInventory: null,
          maxPages: 1,
          startCursor: { ...second.cursor, checksum: "0".repeat(64) },
          readPage,
          onBatch,
        }),
      ),
    ).rejects.toThrow("checksum");
    expect(calls).toHaveLength(3);
  });
  test("directory badge changes are diagnostic, required model membership drift blocks", async () => {
    const state = closingState();
    const result = await Effect.runPromise(
      streamJimsimportInventory({
        previousUniqueInventory: null,
        maxPages: 1,
        startCursor: JimsimportCursor.checkpoint({
          ...state,
          phase: "closing-makes",
        }),
        readPage: () =>
          Effect.succeed(
            jimsimportFixture("catalog").body.replace(
              ">65</span>",
              ">999</span>",
            ),
          ),
        onBatch: () => Effect.die("Early emission"),
      }),
    );
    expect(result.cursor.phase).toBe("closing-models");
    if (result.cursor.phase !== "closing-models")
      throw new Error("Wrong closing phase");
    let calls = 0;
    await expect(
      Effect.runPromise(
        streamJimsimportInventory({
          previousUniqueInventory: null,
          startCursor: result.cursor,
          readPage: () => {
            calls++;
            return Effect.succeed(
              jimsimportFixture("acura").body.replaceAll(
                '/used-parts/ACURA/CL"',
                '/used-parts/ACURA/NEW"',
              ),
            );
          },
          onBatch: () => Effect.die("Early emission"),
        }),
      ),
    ).rejects.toThrow("membership");
    expect(calls).toBe(1);
  });
  test("closing VIN drift aborts before callbacks and the next native request", async () => {
    const state = closingState();
    const result = await Effect.runPromise(
      streamJimsimportInventory({
        previousUniqueInventory: null,
        maxPages: 1,
        startCursor: JimsimportCursor.checkpoint({
          ...state,
          phase: "closing",
          closing: [],
        }),
        readPage: () => Effect.succeed(jimsimportFixture("cl").body),
        onBatch: () => Effect.die("Early emission"),
      }),
    );
    let calls = 0,
      emitted = 0;
    await expect(
      Effect.runPromise(
        streamJimsimportInventory({
          previousUniqueInventory: null,
          startCursor: result.cursor,
          readPage: () => {
            calls++;
            return Effect.succeed(
              jimsimportFixture("ilx").body.replace(
                "19UDE2F72LA002870",
                "WBA7E2C59GG504712",
              ),
            );
          },
          onBatch: () =>
            Effect.sync(() => {
              emitted++;
            }),
        }),
      ),
    ).rejects.toThrow("closing required");
    expect(calls).toBe(1);
    expect(emitted).toBe(0);
  });
  test("owner closure emits once, with changed optional metadata nulled", async () => {
    const state = closingState();
    const closing = state.opening.map((p) => ({
      ...p,
      records: p.records.map((r) =>
        r.id === "21F104" ? { ...r, image: null } : r,
      ),
    }));
    const emitted: JimsimportVehicle[][] = [];
    let yards = 0;
    const result = await Effect.runPromise(
      streamJimsimportInventory({
        previousUniqueInventory: null,
        startCursor: JimsimportCursor.checkpoint({
          ...state,
          phase: "owner-closing",
          closing,
        }),
        readPage: () => Effect.succeed(jimsimportFixture("owner").body),
        onBatch: (batch) =>
          Effect.sync(() => {
            emitted.push(batch);
          }),
        onYards: (values) =>
          Effect.sync(() => {
            expect(values).toHaveLength(1);
            expect(values[0]?.state).toBe("FL");
            yards++;
          }),
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.count).toBe(3649);
    expect(emitted).toHaveLength(1);
    expect(yards).toBe(1);
    expect(result.accounting.recordsRejected).toBe(367);
    expect(
      emitted[0]?.find((v) => v.stockNumber === "21F104")?.imageUrl,
    ).toBeNull();
    const again = await Effect.runPromise(
      streamJimsimportInventory({
        previousUniqueInventory: null,
        startCursor: result.cursor,
        readPage: () => Effect.die("Completed cursor fetched"),
        onBatch: () => Effect.die("Completed cursor emitted"),
      }),
    );
    expect(again.pagesProcessed).toBe(0);
  });
  test("owner changes and incomplete closing checkpoints emit nothing", async () => {
    const state = closingState();
    expect(() =>
      JimsimportCursor.checkpoint({
        ...state,
        phase: "owner-closing",
        closing: state.opening.slice(1),
      }),
    ).toThrow("frontier");
    let emitted = 0;
    await expect(
      Effect.runPromise(
        streamJimsimportInventory({
          previousUniqueInventory: null,
          startCursor: JimsimportCursor.checkpoint({
            ...state,
            phase: "owner-closing",
            closing: state.opening,
          }),
          readPage: () =>
            Effect.succeed(
              jimsimportFixture("owner").body.replaceAll(
                "3636 DeSoto Rd",
                "9999 Other St",
              ),
            ),
          onBatch: () =>
            Effect.sync(() => {
              emitted++;
            }),
        }),
      ),
    ).rejects.toThrow("physical owner");
    expect(emitted).toBe(0);
  });
  test("rejected conflicting rows quarantine connected otherwise-valid VIN claims", () => {
    const { menus, pages } = jimsimportOpeningFixture();
    const changed = pages.map((p, i) =>
      i === 1
        ? {
            ...p,
            records: p.records.map((r, j) =>
              j === 1 ? { ...r, vin: "19UDE2F72LA002870", title: "" } : r,
            ),
          }
        : p,
    );
    const snapshot = jimsimportSnapshot(menus, changed);
    expect(snapshot.vehicles.some((v) => v.vin === "19UDE2F72LA002870")).toBe(
      false,
    );
    expect(snapshot.observedVins).toContain("19UDE2F72LA002870");
    expect(snapshot.accounting.recordsRejected).toBe(369);
  });
  test("whole-run budgets fail before a request and preserve callbacks", async () => {
    const state = closingState();
    let calls = 0;
    await expect(
      Effect.runPromise(
        streamJimsimportInventory({
          previousUniqueInventory: null,
          startCursor: JimsimportCursor.checkpoint({
            ...state,
            requests: 1024,
            phase: "closing-makes",
          }),
          readPage: () => {
            calls++;
            return Effect.succeed("");
          },
          onBatch: () => Effect.die("Early emission"),
        }),
      ),
    ).rejects.toThrow("whole-run budget");
    expect(calls).toBe(0);
  });
  test("HTTP rejects redirects, denials, partial/non-HTML responses and foreign destinations without retries", async () => {
    let calls = 0;
    const preconnect = globalThis.fetch.preconnect;
    const mocked = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          calls++;
          return new Response("denied", {
            status: 403,
            headers: { "content-type": "text/html" },
          });
        },
        { preconnect },
      ),
    );
    try {
      await expect(
        Effect.runPromise(
          readJimsimportPage(
            "https://foreign.example/used-parts/ACURA",
            (effect) => effect,
          ),
        ),
      ).rejects.toThrow("destination");
      expect(calls).toBe(0);
      for (const response of [
        new Response("denied", {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
        new Response("redirect", {
          status: 302,
          headers: {
            location: "https://other.example/",
            "content-type": "text/html",
          },
        }),
        new Response("partial", {
          headers: {
            "content-range": "bytes 0-6/100",
            "content-type": "text/html",
          },
        }),
        new Response("{}", { headers: { "content-type": "application/json" } }),
      ]) {
        mocked.mockImplementation(
          Object.assign(
            async () => {
              calls++;
              return response;
            },
            { preconnect },
          ),
        );
        await expect(
          Effect.runPromise(
            readJimsimportPage(JIMSIMPORT_OWNER, (effect) => effect),
          ),
        ).rejects.toThrow("Expected complete owned");
      }
      expect(calls).toBe(4);
    } finally {
      mocked.mockRestore();
    }
  });
});
